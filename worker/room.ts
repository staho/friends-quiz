import { DurableObject } from "cloudflare:workers"
import { type HostSession, type PlayerSession } from "../shared/types.ts"
import { parseClientMessage, type ClientMessage } from "../shared/wire.ts"
import {
  GameError,
  applyTick,
  createRoom,
  difficultyForSlot,
  endGame,
  isAdvanceDue,
  joinPlayer,
  lockAnswer,
  nextQuestion,
  reconnectPlayer,
  resetRound,
  restoreRoom,
  roundStats,
  setPlayerConnected,
  snapshotFor,
  startGame,
  submitChoice,
  toggleAdvancePause,
  type Question,
  type Room,
} from "../server/game.ts"

type Seat = { role: "host" } | { role: "player"; playerId: string }

export class RoomDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data TEXT NOT NULL
        )
      `)
    })
  }

  async open(input: { code: string; hostToken: string }): Promise<HostSession | null> {
    if (this.readRoom()) return null
    const room = createRoom({
      code: input.code,
      hostToken: input.hostToken,
    })
    this.writeRoom(room)
    return { code: room.code, hostToken: room.hostToken }
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
      if (id) ws.send(JSON.stringify({ id, ok: false, error: "Something went wrong" }))
      return
    }
    try {
      const data = await this.handle(ws, command)
      ws.send(JSON.stringify({ id: command.id, ok: true, data }))
    } catch (error) {
      const text = error instanceof GameError ? error.message : "Something went wrong"
      if (!(error instanceof GameError)) console.error(error)
      ws.send(JSON.stringify({ id: command.id, ok: false, error: text }))
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const seat = readSeat(ws)
    if (!seat || seat.role !== "player") return
    const stillHere = this.ctx.getWebSockets().some((other) => {
      if (other === ws) return false
      const otherSeat = readSeat(other)
      return otherSeat?.role === "player" && otherSeat.playerId === seat.playerId
    })
    if (stillHere) return
    const room = this.readRoom()
    if (!room) return
    const now = Date.now()
    const next = applyTick(setPlayerConnected(room, seat.playerId, false), now)
    await this.commit(next, now)
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error(error)
  }

  async alarm(): Promise<void> {
    const room = this.readRoom()
    if (!room) return
    const now = Date.now()
    if (isAdvanceDue(room, now)) {
      await this.commit(await this.advance(room, now), now)
      return
    }
    const next = applyTick(room, now)
    if (next === room) {
      await this.arm(room)
      return
    }
    await this.commit(next, now)
  }

  private async handle(ws: WebSocket, message: ClientMessage): Promise<unknown> {
    switch (message.event) {
      case "host:attach":
        return this.attachHost(ws, message.payload)
      case "host:start":
        this.requireHost(ws)
        await this.mutate(async (room, now) => startGame(room, await this.deal(room), now))
        return null
      case "host:next":
        this.requireHost(ws)
        await this.mutate((room, now) => this.advance(room, now))
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
      case "player:join":
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
      default:
        throw new GameError("Something went wrong")
    }
  }

  private async attachHost(ws: WebSocket, payload: { code: string; hostToken: string }): Promise<HostSession> {
    const room = this.readRoom()
    const code = payload.code.trim().toUpperCase()
    if (!room || room.hostToken !== payload.hostToken || room.code !== code) {
      throw new GameError("Room not found")
    }
    ws.serializeAttachment({ role: "host" } satisfies Seat)
    const now = Date.now()
    await this.commit(applyTick(room, now), now)
    return { code: room.code, hostToken: room.hostToken }
  }

  private async join(ws: WebSocket, payload: { code: string; name: string }): Promise<PlayerSession> {
    const room = this.readRoom()
    if (!room) throw new GameError("Room not found")
    const code = payload.code.trim().toUpperCase()
    if (code !== room.code) throw new GameError("Room not found")
    const now = Date.now()
    const ticked = applyTick(room, now)
    let joined: ReturnType<typeof joinPlayer>
    try {
      joined = joinPlayer(ticked, {
        id: crypto.randomUUID(),
        name: payload.name,
        token: newToken(),
      })
    } catch (error) {
      if (ticked !== room) await this.commit(ticked, now)
      throw error
    }
    const next = applyTick(joined.room, now)
    ws.serializeAttachment({ role: "player", playerId: joined.player.id } satisfies Seat)
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
    if (!room) throw new GameError("Room not found")
    const code = payload.code.trim().toUpperCase()
    if (code !== room.code) throw new GameError("Room not found")
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
    if (!player) throw new GameError("Rejoin the room")
    ws.serializeAttachment({ role: "player", playerId: player.id } satisfies Seat)
    await this.commit(next, now)
    return { code, playerId: player.id, token: player.token, name: player.name }
  }

  private async advance(room: Room, now: number): Promise<Room> {
    if (room.asked.length >= room.questionLimit) return nextQuestion(room, null, now)
    return nextQuestion(room, await this.dealOrFinish(room), now)
  }

  private async deal(room: Room): Promise<Question> {
    const question = await this.dealOrFinish(room)
    if (!question) throw new GameError("No questions available")
    return question
  }

  private async dealOrFinish(room: Room): Promise<Question | null> {
    const picked = await this.env.CATALOG.getByName("questions").pickRandom(
      [...roundStats(room).askedIds],
      difficultyForSlot(room.asked.length),
    )
    if (!picked || picked.choices.length !== 4) return null
    const [first, second, third, fourth] = picked.choices
    if (first == null || second == null || third == null || fourth == null) return null
    return {
      id: picked.id,
      prompt: picked.prompt,
      choices: [first, second, third, fourth],
      correctIndex: picked.correctIndex,
      category: picked.category,
      difficulty: picked.difficulty,
    }
  }

  private async mutate(run: (room: Room, now: number) => Room | Promise<Room>): Promise<void> {
    const room = this.readRoom()
    if (!room) throw new GameError("Room not found")
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
    const flushed = await this.flushPlays(room)
    this.writeRoom(flushed)
    await this.arm(flushed)
    this.broadcast(flushed, now)
  }

  private async flushPlays(room: Room): Promise<Room> {
    if (room.pendingPlays.length === 0) return room
    const accepted: string[] = []
    try {
      for (const play of room.pendingPlays) {
        await this.env.CATALOG.getByName("questions").recordPlay(play)
        accepted.push(play.playId)
      }
    } catch (error) {
      console.error(error)
    }
    if (accepted.length === 0) return room
    const acceptedIds = new Set(accepted)
    return {
      ...room,
      pendingPlays: room.pendingPlays.filter((play) => !acceptedIds.has(play.playId)),
    }
  }

  private async arm(room: Room): Promise<void> {
    const deadline = alarmAt(room)
    if (deadline == null) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    const existing = await this.ctx.storage.getAlarm()
    if (existing !== deadline) await this.ctx.storage.setAlarm(deadline)
  }

  private broadcast(room: Room, now: number): void {
    for (const ws of this.ctx.getWebSockets()) {
      const seat = readSeat(ws)
      if (!seat) continue
      const snapshot = snapshotFor(
        room,
        seat.role === "player" ? { role: "player", playerId: seat.playerId } : { role: "host" },
        now,
        [],
      )
      ws.send(JSON.stringify({ event: "state", data: snapshot }))
    }
  }

  private requireHost(ws: WebSocket): void {
    const seat = readSeat(ws)
    if (!seat || seat.role !== "host") throw new GameError("Open the host screen first")
  }

  private requirePlayer(ws: WebSocket): { playerId: string } {
    const seat = readSeat(ws)
    if (!seat || seat.role !== "player") throw new GameError("Join a room first")
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

function alarmAt(room: Room): number | null {
  if (room.phase === "question" && room.questionStartedAt != null) {
    return room.questionStartedAt + room.questionDurationMs
  }
  if (room.phase === "reveal" && !room.advancePaused && room.advanceAt != null) return room.advanceAt
  return null
}

function readSeat(ws: WebSocket): Seat | null {
  const seat = ws.deserializeAttachment() as Seat | null
  if (!seat || (seat.role !== "host" && seat.role !== "player")) return null
  return seat
}

function newToken(): string {
  return crypto.randomUUID().replaceAll("-", "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object"
}
