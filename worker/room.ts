import { DurableObject } from "cloudflare:workers"
import type { ErrorCode } from "../shared/errors.ts"
import { MAX_JOINS_PER_SOCKET, type HostSession, type PlayerSession } from "../shared/types.ts"
import { parseClientMessage, type ClientMessage } from "../shared/wire.ts"
import {
  GameError,
  advanceDue,
  alarmAt,
  applyTick,
  clearStall,
  createRoom,
  difficultyBounds,
  difficultyForSlot,
  endGame,
  expiresAt,
  joinPlayer,
  leavePlayer,
  lockAnswer,
  nextQuestion,
  normalizeName,
  reconnectPlayer,
  removePlayer,
  resetRound,
  restoreRoom,
  setPlayerConnected,
  snapshotFor,
  stallAdvance,
  startGame,
  submitChoice,
  takeFromDeck,
  toggleAdvancePause,
  updateSettings,
  withLiveConnections,
  type Question,
  type Room,
} from "../server/game.ts"
import { createSerialQueue } from "../server/serial.ts"

type Seat =
  | { role: "host"; joins: number }
  | { role: "player"; playerId: string; joins: number }
  | { role: "guest"; joins: number }

export class RoomDurableObject extends DurableObject<Env> {
  // Every entry point runs inside this queue, so one task finishes (including
  // its awaits) before the next one reads the room.
  private readonly serial = createSerialQueue()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ensureTable()
    })
    // Answers the client heartbeat without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
  }

  private ensureTable(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
      )
    `)
  }

  open(input: { code: string; hostToken: string }): Promise<HostSession | null> {
    return this.serial(async () => {
      if (this.readRoom()) return null
      const room = createRoom({
        code: input.code,
        hostToken: input.hostToken,
      })
      await this.commit(room, Date.now())
      return { code: room.code, hostToken: room.hostToken }
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 })
    }
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }
    const command = parseClientMessage(parsed)
    const id = isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : null
    if (!command) {
      if (id) ws.send(JSON.stringify({ id, ok: false, error: "bad_request" }))
      return
    }
    await this.serial(async () => {
      try {
        const data = await this.handle(ws, command)
        ws.send(JSON.stringify({ id: command.id, ok: true, data }))
      } catch (error) {
        const code: ErrorCode = error instanceof GameError ? error.code : "server_error"
        if (!(error instanceof GameError)) console.error(error)
        ws.send(JSON.stringify({ id: command.id, ok: false, error: code }))
      }
    })
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.serial(() => this.releaseSeat(ws))
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error(error)
    try {
      await this.serial(() => this.releaseSeat(ws))
    } finally {
      try {
        ws.close()
      } catch {
        // The runtime may already have closed this socket.
      }
    }
  }

  async alarm(): Promise<void> {
    await this.serial(async () => {
      const room = this.readRoom()
      if (!room) return
      const now = Date.now()
      if (alarmAt(room) == null) {
        // Expiry alarm: delete a room that has been idle for the whole TTL.
        const expiry = expiresAt(room)
        if (expiry != null && now >= expiry) {
          if (this.openSockets() > 0) {
            await this.commit(room, now)
            return
          }
          await this.ctx.storage.deleteAlarm()
          await this.ctx.storage.deleteAll()
          this.ensureTable()
          return
        }
        await this.arm(room)
        return
      }
      const ticked = applyTick(room, now)
      if (!advanceDue(ticked, now)) {
        if (ticked === room) await this.arm(room)
        else await this.commit(ticked, now)
        return
      }
      try {
        const dealt =
          ticked.asked.length >= ticked.questionLimit
            ? { room: ticked, question: null }
            : await this.dealOrFinish(ticked)
        await this.commit(clearStall(applyTick(nextQuestion(dealt.room, dealt.question, now), now)), now)
      } catch (error) {
        console.error(error)
        // Retry in DEAL_RETRY_MS; the host sees `stalled` meanwhile.
        await this.commit(stallAdvance(ticked, now), now)
      }
    })
  }

  private async handle(ws: WebSocket, message: ClientMessage): Promise<unknown> {
    switch (message.event) {
      case "host:attach":
        return this.attachHost(ws, message.payload)
      case "host:start":
        this.requireHost(ws)
        await this.mutate(async (room, now) => {
          const dealt = await this.deal(room)
          return clearStall(startGame(dealt.room, dealt.question, now))
        })
        return null
      case "host:next":
        this.requireHost(ws)
        await this.mutate(async (room, now) => {
          // A second press while the next question is already ready changes nothing.
          if (room.phase === "ready") return room
          if (room.asked.length >= room.questionLimit) return clearStall(nextQuestion(room, null, now))
          const dealt = await this.dealOrFinish(room)
          return clearStall(nextQuestion(dealt.room, dealt.question, now))
        })
        return null
      case "host:pause":
        this.requireHost(ws)
        await this.mutate((room, now) => toggleAdvancePause(room, now))
        return null
      case "host:end":
        this.requireHost(ws)
        await this.mutate((room) => endGame(room))
        return null
      case "host:reset":
        this.requireHost(ws)
        await this.mutate((room) => resetRound(room))
        return null
      case "host:settings":
        this.requireHost(ws)
        await this.mutate((room, now) => updateSettings(room, message.payload, now))
        return null
      case "host:remove":
        this.requireHost(ws)
        await this.mutate((room) => removePlayer(room, message.payload.playerId))
        return null
      case "player:join":
        this.countJoin(ws)
        return this.join(ws, message.payload)
      case "player:attach":
        return this.attachPlayer(ws, message.payload)
      case "player:choose": {
        const player = this.requirePlayer(ws)
        await this.mutate((room, now) => submitChoice(room, player.playerId, message.payload.choiceIndex, now))
        return null
      }
      case "player:lock": {
        const player = this.requirePlayer(ws)
        await this.mutate((room, now) => lockAnswer(room, player.playerId, now))
        return null
      }
      case "player:leave": {
        const player = this.requirePlayer(ws)
        await this.mutate((room) => leavePlayer(room, player.playerId))
        ws.serializeAttachment({ role: "guest", joins: joinsOf(ws) } satisfies Seat)
        return null
      }
      default:
        throw new GameError("bad_request")
    }
  }

  private async attachHost(ws: WebSocket, payload: { code: string; hostToken: string }): Promise<HostSession> {
    const room = this.readRoom()
    const code = payload.code.trim().toUpperCase()
    if (!room || room.hostToken !== payload.hostToken || room.code !== code) {
      throw new GameError("room_not_found")
    }
    ws.serializeAttachment({ role: "host", joins: joinsOf(ws) } satisfies Seat)
    const now = Date.now()
    await this.commit(applyTick(room, now), now)
    return { code: room.code, hostToken: room.hostToken }
  }

  private async join(ws: WebSocket, payload: { code: string; name: string }): Promise<PlayerSession> {
    const room = this.readRoom()
    if (!room) throw new GameError("room_not_found")
    const code = payload.code.trim().toUpperCase()
    if (code !== room.code) throw new GameError("room_not_found")
    const name = normalizeName(payload.name)
    const seated = this.sessionForSeat(ws, room, name)
    if (seated) return seated
    const now = Date.now()
    const present = withLiveConnections(applyTick(room, now), this.openPlayerIds(ws))
    let joined: ReturnType<typeof joinPlayer>
    try {
      joined = joinPlayer(present, {
        id: crypto.randomUUID(),
        name,
        token: newToken(),
      })
    } catch (error) {
      if (present !== room) await this.commit(present, now)
      throw error
    }
    const next = applyTick(joined.room, now)
    ws.serializeAttachment({ role: "player", playerId: joined.player.id, joins: joinsOf(ws) } satisfies Seat)
    await this.commit(next, now)
    return {
      code,
      playerId: joined.player.id,
      token: joined.player.token,
      name: joined.player.name,
    }
  }

  private async attachPlayer(
    ws: WebSocket,
    payload: { code: string; playerId: string; token: string },
  ): Promise<PlayerSession> {
    const room = this.readRoom()
    if (!room) throw new GameError("room_not_found")
    const code = payload.code.trim().toUpperCase()
    if (code !== room.code) throw new GameError("room_not_found")
    const now = Date.now()
    const ticked = applyTick(room, now)
    let reconnected: Room
    try {
      reconnected = reconnectPlayer(ticked, payload.playerId, payload.token)
    } catch (error) {
      if (ticked !== room) await this.commit(ticked, now)
      throw error
    }
    const next = applyTick(reconnected, now)
    const player = next.players.find((item) => item.id === payload.playerId)
    if (!player) throw new GameError("rejoin")
    ws.serializeAttachment({ role: "player", playerId: player.id, joins: joinsOf(ws) } satisfies Seat)
    await this.commit(next, now)
    return { code, playerId: player.id, token: player.token, name: player.name }
  }

  private async deal(room: Room): Promise<{ room: Room; question: Question }> {
    const dealt = await this.dealOrFinish(room)
    if (!dealt.question) throw new GameError("no_questions")
    return { room: dealt.room, question: dealt.question }
  }

  private async dealOrFinish(room: Room): Promise<{ room: Room; question: Question | null }> {
    const bounds = difficultyBounds(room.difficulty)
    const slot = difficultyForSlot(room.asked.length)
    const target = bounds ? Math.min(bounds.maxDifficulty, Math.max(bounds.minDifficulty, slot)) : slot
    const catalog = this.env.CATALOG.getByName("questions")
    // takeFromDeck returns a shuffled copy that still carries category and categoryLabel.
    return takeFromDeck(room, target, bounds, (excludeIds, difficulty, pickBounds, categoryCounts) => {
      return catalog.pickRandom([...excludeIds], difficulty, pickBounds, categoryCounts) as Promise<Question | null>
    })
  }

  private async mutate(run: (room: Room, now: number) => Room | Promise<Room>): Promise<void> {
    const room = this.readRoom()
    if (!room) throw new GameError("room_not_found")
    const now = Date.now()
    const ticked = applyTick(room, now)
    let mutated: Room
    try {
      mutated = await run(ticked, now)
    } catch (error) {
      if (ticked !== room) await this.commit(ticked, now)
      throw error
    }
    await this.commit(applyTick(mutated, now), now)
  }

  private async commit(room: Room, now: number): Promise<void> {
    const stamped: Room = { ...room, lastActivityAt: now }
    this.writeRoom(stamped)
    await this.arm(stamped)
    this.broadcast(stamped, now)
    if (stamped.pendingPlays.length > 0) void this.serial(() => this.flushPlays())
  }

  // Records finished plays with the catalog after the room is saved and sent, so a
  // slow catalog never delays the table. It works on a fresh copy of the room.
  private async flushPlays(): Promise<void> {
    const room = this.readRoom()
    if (!room || room.pendingPlays.length === 0) return
    const accepted = new Set<string>()
    try {
      for (const play of room.pendingPlays) {
        await this.env.CATALOG.getByName("questions").recordPlay(play)
        accepted.add(play.playId)
      }
    } catch (error) {
      console.error(error)
    }
    if (accepted.size === 0) return
    const fresh = this.readRoom()
    if (!fresh) return
    this.writeRoom({ ...fresh, pendingPlays: fresh.pendingPlays.filter((play) => !accepted.has(play.playId)) })
  }

  private async arm(room: Room): Promise<void> {
    const deadline = alarmAt(room) ?? expiresAt(room)
    if (deadline == null) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    const existing = await this.ctx.storage.getAlarm()
    if (existing !== deadline) await this.ctx.storage.setAlarm(deadline)
  }

  private broadcast(room: Room, now: number): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const seat = readSeat(ws)
        if (!seat || seat.role === "guest") continue
        const snapshot = snapshotFor(
          room,
          seat.role === "player" ? { role: "player", playerId: seat.playerId } : { role: "host" },
          now,
          [],
        )
        ws.send(JSON.stringify({ event: "state", data: snapshot }))
      } catch (error) {
        console.error(error)
      }
    }
  }

  private async releaseSeat(ws: WebSocket): Promise<void> {
    const seat = readSeat(ws)
    if (!seat || seat.role !== "player") return
    if (this.openPlayerIds(ws).has(seat.playerId)) return
    const room = this.readRoom()
    if (!room) return
    const player = room.players.find((item) => item.id === seat.playerId)
    if (!player?.connected) return
    const now = Date.now()
    const next = applyTick(setPlayerConnected(room, seat.playerId, false), now)
    await this.commit(next, now)
  }

  private openSockets(): number {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN).length
  }

  // Counts every join attempt on this socket, successful or not.
  private countJoin(ws: WebSocket): void {
    const seat = readSeat(ws) ?? { role: "guest" as const, joins: 0 }
    const joins = seat.joins + 1
    ws.serializeAttachment({ ...seat, joins } satisfies Seat)
    if (joins > MAX_JOINS_PER_SOCKET) throw new GameError("too_many_joins")
  }

  private openPlayerIds(except?: WebSocket): Set<string> {
    const ids = new Set<string>()
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except || socket.readyState !== WebSocket.OPEN) continue
      const seat = readSeat(socket)
      if (seat?.role === "player") ids.add(seat.playerId)
    }
    return ids
  }

  private sessionForSeat(ws: WebSocket, room: Room, name: string): PlayerSession | null {
    const seat = readSeat(ws)
    if (seat?.role !== "player") return null
    const player = room.players.find((item) => item.id === seat.playerId)
    if (!player || player.name.toLowerCase() !== name.toLowerCase()) return null
    return { code: room.code, playerId: player.id, token: player.token, name: player.name }
  }

  private requireHost(ws: WebSocket): void {
    const seat = readSeat(ws)
    if (!seat || seat.role !== "host") throw new GameError("host_only")
  }

  private requirePlayer(ws: WebSocket): { playerId: string } {
    const seat = readSeat(ws)
    if (!seat || seat.role !== "player") throw new GameError("join_first")
    return { playerId: seat.playerId }
  }

  private readRoom(): Room | null {
    const rows = this.ctx.storage.sql.exec<{ data: string }>("SELECT data FROM room WHERE id = 1").toArray()
    const row = rows[0]
    if (!row) return null
    return restoreRoom(JSON.parse(row.data))
  }

  private writeRoom(room: Room): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO room (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      JSON.stringify(room),
    )
  }
}

function readSeat(ws: WebSocket): Seat | null {
  const raw = ws.deserializeAttachment() as Partial<Seat> | null
  if (!raw || (raw.role !== "host" && raw.role !== "player" && raw.role !== "guest")) return null
  const joins = typeof raw.joins === "number" && Number.isFinite(raw.joins) ? raw.joins : 0
  if (raw.role === "player") {
    return typeof raw.playerId === "string" ? { role: "player", playerId: raw.playerId, joins } : null
  }
  return { role: raw.role, joins }
}

function joinsOf(ws: WebSocket): number {
  return readSeat(ws)?.joins ?? 0
}

function newToken(): string {
  return crypto.randomUUID().replaceAll("-", "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object"
}
