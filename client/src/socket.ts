import type { Ack, HostSession, RoomSnapshot } from "@shared/types"
import type { ClientMessage } from "@shared/wire"

type StateListener = (snapshot: RoomSnapshot) => void
type ConnectionListener = () => void
type AckListener = (res: Ack<unknown>) => void

class QuizSocket {
  connected = false
  private ws: WebSocket | null = null
  private code: string | null = null
  private opening: Promise<void> | null = null
  private openingCode: string | null = null
  private reconnectTimer: number | null = null
  private pending = new Map<string, AckListener>()
  private stateListeners = new Set<StateListener>()
  private connectListeners = new Set<ConnectionListener>()
  private disconnectListeners = new Set<ConnectionListener>()

  constructor() {
    queueMicrotask(() => this.setConnected(true))
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

  emit(
    event: string,
    payloadOrAck?: object | ((res: Ack<never>) => void),
    maybeAck?: (res: Ack<never>) => void,
  ): void {
    const ack: AckListener | undefined =
      typeof maybeAck === "function"
        ? (maybeAck as AckListener)
        : typeof payloadOrAck === "function"
          ? (payloadOrAck as AckListener)
          : undefined
    const payload = typeof payloadOrAck === "function" ? undefined : payloadOrAck
    void this.dispatch(event, payload)
      .then((data) => ack?.({ ok: true, data }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Something went wrong"
        ack?.({ ok: false, error: message })
      })
  }

  private async dispatch(event: string, payload: unknown): Promise<unknown> {
    if (event === "host:create") return this.createHost()
    if (event === "host:attach" || event === "player:join" || event === "player:attach") {
      await this.ensure(codeFrom(payload))
    } else if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Reconnecting to the table")
    }
    return this.rpc(event, payload)
  }

  private async createHost(): Promise<HostSession> {
    const response = await fetch("/api/rooms", { method: "POST" })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new Error("Could not open a room")
    }
    if (!response.ok || !isHostSession(body)) {
      const message =
        body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Could not open a room"
      throw new Error(message)
    }
    await this.ensure(body.code)
    await this.rpc("host:attach", { code: body.code, hostToken: body.hostToken })
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
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const previous = this.ws
    const ws = new WebSocket(socketUrl(code))
    this.ws = ws
    this.code = code
    previous?.close()
    return new Promise((resolve, reject) => {
      let settled = false
      ws.addEventListener(
        "open",
        () => {
          if (settled || this.ws !== ws) return
          settled = true
          this.setConnected(true)
          resolve()
        },
        { once: true },
      )
      ws.addEventListener(
        "error",
        () => {
          if (this.ws !== ws) return
          if (!settled) {
            settled = true
            reject(new Error("Could not reach the table"))
          }
          ws.close()
        },
        { once: true },
      )
      ws.addEventListener("message", (event) => {
        if (this.ws !== ws || typeof event.data !== "string") return
        this.onMessage(event.data)
      })
      ws.addEventListener("close", () => {
        if (this.ws !== ws) return
        this.ws = null
        this.failPending("Reconnecting to the table")
        this.setConnected(false)
        this.scheduleReconnect()
      })
    })
  }

  private scheduleReconnect(): void {
    if (!this.code || this.reconnectTimer != null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      const code = this.code
      if (!code) return
      void this.ensure(code).catch(() => this.scheduleReconnect())
    }, 600)
  }

  private rpc(event: string, payload?: unknown): Promise<unknown> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Reconnecting to the table"))
    const id = crypto.randomUUID()
    const message: ClientMessage = payload === undefined ? { id, event } as ClientMessage : { id, event, payload } as ClientMessage
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error("The table did not answer"))
      }, 8000)
      this.pending.set(id, (res) => {
        window.clearTimeout(timer)
        if (res.ok) resolve(res.data)
        else reject(new Error(res.error))
      })
      ws.send(JSON.stringify(message))
    })
  }

  private onMessage(raw: string): void {
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
    else ack({ ok: false, error: typeof message.error === "string" ? message.error : "Something went wrong" })
  }

  private failPending(error: string): void {
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

function codeFrom(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.code !== "string" || payload.code.trim() === "") {
    throw new Error("Room not found")
  }
  return payload.code
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
      else reject(new Error(res.error))
    })
  })
}
