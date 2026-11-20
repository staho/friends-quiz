import { DIFFICULTY_BANDS, type Ack, type ClientToServerEvents, type HostSession, type RoomSettings, type RoomSnapshot } from "@shared/types"
import type { ClientMessage } from "@shared/wire"
import { isErrorCode, type ErrorCode } from "@shared/errors"
import { reconnectDelay } from "./backoff"
import { errorCode, errorText } from "./errors"

export class QuizError extends Error {
  constructor(readonly code: ErrorCode) {
    super(errorText(code))
    this.name = "QuizError"
  }
}

type PayloadMessage = Extract<ClientMessage, { payload: unknown }>
type PayloadEvent = PayloadMessage["event"]
type PayloadOf<E extends PayloadEvent> = Extract<PayloadMessage, { event: E }>["payload"]
type DeclaredPayload<E extends PayloadEvent> = Parameters<ClientToServerEvents[E]>[0]
type PayloadsMatch = {
  [E in PayloadEvent]: DeclaredPayload<E> extends PayloadOf<E> ? (PayloadOf<E> extends DeclaredPayload<E> ? true : false) : false
}[PayloadEvent]
const clientEventsMatchWire: PayloadsMatch = true
void clientEventsMatchWire

type StateListener = (snapshot: RoomSnapshot) => void
type ConnectionListener = () => void
type AckListener = (res: Ack<unknown>) => void

export class QuizSocket {
  connected = true
  private ws: WebSocket | null = null
  private code: string | null = null
  private opening: Promise<void> | null = null
  private openingCode: string | null = null
  private reconnectTimer: number | null = null
  private attempt = 0
  private heartbeat: number | null = null
  private settleOpen: ((error: QuizError) => void) | null = null
  private deadline: number | null = null
  private pending = new Map<string, AckListener>()
  private stateListeners = new Set<StateListener>()
  private connectListeners = new Set<ConnectionListener>()
  private disconnectListeners = new Set<ConnectionListener>()

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !this.code) return
      if (this.ws?.readyState === WebSocket.OPEN) this.sendPing()
      else this.reopen()
    })
    // After a network change nothing about the old socket can be trusted: replace it.
    window.addEventListener("online", () => {
      if (this.code) this.reopen()
    })
    window.addEventListener("offline", () => {
      if (this.ws) this.lose(this.ws)
    })
  }

  /** Drop whatever socket we have and open a fresh one right now. */
  private reopen(): void {
    const code = this.code
    if (!code) return
    this.clearReconnect()
    if (this.ws) this.retire(this.ws)
    this.attempt = 0
    this.opening = null
    this.openingCode = null
    void this.ensure(code).catch(() => this.scheduleReconnect())
  }

  /**
   * The only place a socket stops being current. Idempotent per socket: a late event from an
   * already retired socket does nothing. Marks us disconnected at once, so the banner shows and
   * the next successful open always fires "connect" again (screens re-attach on it).
   */
  private retire(ws: WebSocket): boolean {
    if (this.ws !== ws) return false
    this.ws = null
    this.stopHeartbeat()
    this.failPending("reconnecting")
    this.settleOpen?.(new QuizError("unreachable"))
    try {
      ws.close()
    } catch {
      // already gone
    }
    this.setConnected(false)
    return true
  }

  private lose(ws: WebSocket): void {
    if (this.retire(ws)) this.scheduleReconnect()
  }

  private clearReconnect(): void {
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private sendPing(): void {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || this.deadline != null) return
    try {
      ws.send("ping")
    } catch {
      this.lose(ws)
      return
    }
    this.deadline = window.setTimeout(() => {
      this.deadline = null
      this.lose(ws)
    }, 8000)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = window.setInterval(() => this.sendPing(), 20000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat != null) window.clearInterval(this.heartbeat)
    if (this.deadline != null) window.clearTimeout(this.deadline)
    this.heartbeat = null
    this.deadline = null
  }

  on(event: "state", listener: StateListener): void
  on(event: "connect" | "disconnect", listener: ConnectionListener): void
  on(event: "state" | "connect" | "disconnect", listener: StateListener | ConnectionListener): void {
    if (event === "state") this.stateListeners.add(listener as StateListener)
    else if (event === "connect") this.connectListeners.add(listener as ConnectionListener)
    else this.disconnectListeners.add(listener as ConnectionListener)
  }

  off(event: "state", listener: StateListener): void
  off(event: "connect" | "disconnect", listener: ConnectionListener): void
  off(event: "state" | "connect" | "disconnect", listener: StateListener | ConnectionListener): void {
    if (event === "state") this.stateListeners.delete(listener as StateListener)
    else if (event === "connect") this.connectListeners.delete(listener as ConnectionListener)
    else this.disconnectListeners.delete(listener as ConnectionListener)
  }

  emit<E extends keyof ClientToServerEvents>(event: E, ...args: Parameters<ClientToServerEvents[E]>): void {
    const last = args[args.length - 1]
    const ack: AckListener | undefined = typeof last === "function" ? (last as AckListener) : undefined
    const body = typeof last === "function" && args.length === 1 ? undefined : args[0]
    void this.dispatch(event, body)
      .then((data) => ack?.({ ok: true, data }))
      .catch((error: unknown) => {
        ack?.({ ok: false, error: errorCode(error) })
      })
  }

  private async dispatch(event: string, payload: unknown): Promise<unknown> {
    if (event === "host:create") return this.createHost()
    const message = clientMessage(event, payload)
    if (message.event === "host:attach" || message.event === "player:join" || message.event === "player:attach") {
      await this.ensure(message.payload.code)
    } else if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new QuizError("reconnecting")
    }
    const sent = this.ws
    try {
      return await this.rpc(message)
    } catch (error) {
      // The server sees this socket as an unattached guest: our attach was lost. Replace the
      // socket so the screen re-attaches on "connect" instead of showing the raw error.
      const code = errorCode(error)
      const isAttach = message.event === "host:attach" || message.event === "player:attach" || message.event === "player:join"
      if (!isAttach && (code === "join_first" || code === "host_only") && sent && this.ws === sent) {
        this.lose(sent)
        this.reopen()
        throw new QuizError("reconnecting")
      }
      throw error
    }
  }

  private async createHost(): Promise<HostSession> {
    const response = await fetch("/api/rooms", { method: "POST" })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new QuizError("could_not_open_room")
    }
    if (!response.ok || !isHostSession(body)) {
      const code = isRecord(body) && isErrorCode(body.error) ? body.error : "could_not_open_room"
      throw new QuizError(code)
    }
    await this.ensure(body.code)
    await this.rpc({
      id: crypto.randomUUID(),
      event: "host:attach",
      payload: { code: body.code, hostToken: body.hostToken },
    })
    return body
  }

  private ensure(code: string): Promise<void> {
    const normalized = code.trim().toUpperCase()
    if (this.ws?.readyState === WebSocket.OPEN && this.code === normalized) return Promise.resolve()
    if (this.opening && this.openingCode === normalized) return this.opening
    this.openingCode = normalized
    const opening = this.open(normalized).finally(() => {
      if (this.opening === opening) {
        this.opening = null
        this.openingCode = null
      }
    })
    this.opening = opening
    return opening
  }

  private open(code: string): Promise<void> {
    this.clearReconnect()
    const previous = this.ws
    if (previous) this.retire(previous)
    const ws = new WebSocket(socketUrl(code))
    this.ws = ws
    this.code = code
    return new Promise((resolve, reject) => {
      let settled = false
      let connectTimer: number | null = null
      const settle = (error?: QuizError) => {
        if (settled) return
        settled = true
        if (connectTimer != null) window.clearTimeout(connectTimer)
        if (this.settleOpen === settle) this.settleOpen = null
        if (error) reject(error)
        else resolve()
      }
      this.settleOpen = settle
      connectTimer = window.setTimeout(() => this.lose(ws), 8000)
      ws.addEventListener("open", () => {
        if (settled || this.ws !== ws) return
        this.attempt = 0
        this.startHeartbeat()
        settle()
        this.setConnected(true)
      })
      ws.addEventListener("error", () => this.lose(ws))
      ws.addEventListener("message", (event) => {
        if (this.ws !== ws || typeof event.data !== "string") return
        if (this.deadline != null) {
          window.clearTimeout(this.deadline)
          this.deadline = null
        }
        this.onMessage(event.data)
      })
      ws.addEventListener("close", () => this.lose(ws))
    })
  }

  private scheduleReconnect(): void {
    if (!this.code || this.reconnectTimer != null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      const code = this.code
      if (!code) return
      void this.ensure(code).catch(() => this.scheduleReconnect())
    }, reconnectDelay(this.attempt++))
  }

  private rpc(message: ClientMessage): Promise<unknown> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new QuizError("reconnecting"))
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(message.id)
        reject(new QuizError("no_reply"))
      }, 8000)
      this.pending.set(message.id, (res) => {
        window.clearTimeout(timer)
        if (res.ok) resolve(res.data)
        else reject(new QuizError(res.error))
      })
      ws.send(JSON.stringify(message))
    })
  }

  private onMessage(raw: string): void {
    if (raw === "pong") return
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (!isRecord(message)) return
    if (message.event === "state") {
      for (const listener of this.stateListeners) listener(message.data as RoomSnapshot)
      return
    }
    if (typeof message.id !== "string") return
    const ack = this.pending.get(message.id)
    if (!ack) return
    this.pending.delete(message.id)
    if (message.ok === true) ack({ ok: true, data: message.data })
    else ack({ ok: false, error: isErrorCode(message.error) ? message.error : "server_error" })
  }

  private failPending(error: ErrorCode): void {
    for (const ack of this.pending.values()) ack({ ok: false, error })
    this.pending.clear()
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return
    this.connected = connected
    const listeners = connected ? this.connectListeners : this.disconnectListeners
    for (const listener of listeners) listener()
  }
}

function socketUrl(code: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}/ws/${code}`
}

function clientMessage(event: string, payload: unknown): ClientMessage {
  const id = crypto.randomUUID()
  switch (event) {
    case "host:start":
    case "host:next":
    case "host:pause":
    case "host:end":
    case "host:reset":
    case "player:lock":
    case "player:leave":
      return { id, event }
    case "host:attach": {
      if (!isCodeToken(payload)) throw new QuizError("room_not_found")
      return { id, event, payload }
    }
    case "player:join": {
      if (!isCodeName(payload)) throw new QuizError("room_not_found")
      return { id, event, payload }
    }
    case "player:attach": {
      if (!isPlayerAttach(payload)) throw new QuizError("rejoin")
      return { id, event, payload }
    }
    case "player:choose": {
      if (!isRecord(payload) || typeof payload.choiceIndex !== "number") throw new QuizError("bad_request")
      return { id, event, payload: { choiceIndex: payload.choiceIndex } }
    }
    case "host:remove": {
      if (!isPlayerId(payload)) throw new QuizError("bad_request")
      return { id, event, payload: { playerId: payload.playerId } }
    }
    case "host:settings": {
      if (!isSettings(payload)) throw new QuizError("bad_request")
      return { id, event, payload }
    }
    default:
      throw new QuizError("bad_request")
  }
}

function isCodeToken(value: unknown): value is { code: string; hostToken: string } {
  return isRecord(value) && typeof value.code === "string" && typeof value.hostToken === "string"
}

function isCodeName(value: unknown): value is { code: string; name: string } {
  return isRecord(value) && typeof value.code === "string" && typeof value.name === "string"
}

function isPlayerAttach(value: unknown): value is { code: string; playerId: string; token: string } {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.playerId === "string" &&
    typeof value.token === "string"
  )
}

function isPlayerId(value: unknown): value is { playerId: string } {
  return isRecord(value) && typeof value.playerId === "string" && value.playerId !== ""
}

function isSettings(value: unknown): value is RoomSettings {
  return (
    isRecord(value) &&
    typeof value.questionDurationMs === "number" &&
    typeof value.revealDurationMs === "number" &&
    typeof value.autoAdvance === "boolean" &&
    typeof value.difficulty === "string" &&
    DIFFICULTY_BANDS.some((band) => band === value.difficulty)
  )
}

function isHostSession(value: unknown): value is HostSession {
  return isRecord(value) && typeof value.code === "string" && typeof value.hostToken === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object"
}

export const socket = new QuizSocket()

export function request<T>(emit: (ack: (res: Ack<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    emit((res) => {
      if (res.ok) resolve(res.data)
      else reject(new QuizError(res.error))
    })
  })
}
