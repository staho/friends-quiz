import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Server, type Socket } from "socket.io"
import { QUESTIONS_PER_ROUND } from "../shared/types.ts"
import type {
  Ack,
  ClientToServerEvents,
  HostSession,
  PlayerSession,
  ServerToClientEvents,
} from "../shared/types.ts"
import {
  GameError,
  applyTick,
  createRoom,
  endGame,
  joinPlayer,
  lockAnswer,
  nextQuestion,
  reconnectPlayer,
  resetRound,
  selectRound,
  setPlayerConnected,
  snapshotFor,
  startGame,
  submitChoice,
  type Room,
} from "./game.ts"
import { loadQuestionPack } from "./questions.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const distDir = path.join(root, "client", "dist")
const port = Number(process.env.PORT ?? 3000)
const production = process.env.NODE_ENV === "production"
const pack = loadQuestionPack()

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"

type Viewer =
  | { role: "host"; code: string }
  | { role: "player"; code: string; playerId: string }

type Session = {
  room: Room
}

const sessions = new Map<string, Session>()
const viewers = new Map<string, Viewer>()
const playerSockets = new Map<string, string>()
const timers = new Map<string, NodeJS.Timeout>()

const httpServer = createServer((req, res) => {
  if (!req.url || req.url.startsWith("/socket.io")) return
  if (!production) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
    res.end("Friends quiz is running. Open the Vite address /host for the TV.")
    return
  }
  serveStatic(req, res)
})

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: true },
})

io.on("connection", (socket) => {
  socket.on("host:create", (ack) => {
    respond(ack, () => {
      const created = openRoom(socket)
      return { code: created.code, hostToken: created.hostToken }
    })
  })

  socket.on("host:attach", (payload, ack) => {
    respond(ack, () => {
      const session = sessions.get(payload.code)
      if (!session || session.room.hostToken !== payload.hostToken) {
        throw new GameError("Room not found")
      }
      bindHost(socket, payload.code)
      broadcast(payload.code)
      return { code: payload.code, hostToken: payload.hostToken }
    })
  })

  socket.on("host:start", (ack) => {
    respond(ack, () => {
      const code = requireHost(socket)
      update(code, (room) => startGame(room, Date.now()))
      return null
    })
  })

  socket.on("host:next", (ack) => {
    respond(ack, () => {
      const code = requireHost(socket)
      update(code, (room) => nextQuestion(room, Date.now()))
      return null
    })
  })

  socket.on("host:end", (ack) => {
    respond(ack, () => {
      const code = requireHost(socket)
      update(code, (room) => endGame(room))
      return null
    })
  })

  socket.on("host:reset", (ack) => {
    respond(ack, () => {
      const code = requireHost(socket)
      update(code, (room) => resetRound(room, selectRound(pack, QUESTIONS_PER_ROUND)))
      return null
    })
  })

  socket.on("player:join", (payload, ack) => {
    respond(ack, () => join(socket, payload.code, payload.name))
  })

  socket.on("player:attach", (payload, ack) => {
    respond(ack, () => {
      const session = sessions.get(payload.code)
      if (!session) throw new GameError("Room not found")
      session.room = reconnectPlayer(session.room, payload.playerId, payload.token)
      bindPlayer(socket, payload.code, payload.playerId)
      broadcast(payload.code)
      const player = session.room.players.find((item) => item.id === payload.playerId)
      if (!player) throw new GameError("Rejoin the room")
      return {
        code: payload.code,
        playerId: player.id,
        token: player.token,
        name: player.name,
      }
    })
  })

  socket.on("player:choose", (payload, ack) => {
    respond(ack, () => {
      const viewer = requirePlayer(socket)
      update(viewer.code, (room) => submitChoice(room, viewer.playerId, payload.choiceIndex, Date.now()))
      return null
    })
  })

  socket.on("player:lock", (ack) => {
    respond(ack, () => {
      const viewer = requirePlayer(socket)
      update(viewer.code, (room) => lockAnswer(room, viewer.playerId, Date.now()))
      return null
    })
  })

  socket.on("disconnect", () => {
    const viewer = viewers.get(socket.id)
    viewers.delete(socket.id)
    if (!viewer || viewer.role !== "player") return
    if (playerSockets.get(viewer.playerId) !== socket.id) return
    playerSockets.delete(viewer.playerId)
    const session = sessions.get(viewer.code)
    if (!session) return
    session.room = applyTick(setPlayerConnected(session.room, viewer.playerId, false), Date.now())
    armTimer(viewer.code)
    broadcast(viewer.code)
  })
})

httpServer.listen(port, "0.0.0.0", () => {
  const addresses = lanAddresses()
  console.log("Friends quiz")
  console.log(`  Local:   http://localhost:${port}`)
  for (const address of addresses) {
    console.log(`  Network: http://${address}:${port}`)
  }
  if (production) {
    console.log(`  TV:      http://localhost:${port}/host`)
  } else {
    console.log("  TV dev:  http://localhost:5173/host")
  }
})

function openRoom(socket: Socket): HostSession {
  const code = uniqueCode()
  const hostToken = token()
  const room = createRoom({
    code,
    hostToken,
    questions: selectRound(pack, QUESTIONS_PER_ROUND),
  })
  sessions.set(code, { room })
  bindHost(socket, code)
  broadcast(code)
  console.log(`Room ${code}`)
  return { code, hostToken }
}

function join(socket: Socket, code: string, name: string): PlayerSession {
  const normalized = code.trim().toUpperCase()
  const session = sessions.get(normalized)
  if (!session) throw new GameError("Room not found")
  const joined = joinPlayer(session.room, {
    id: crypto.randomUUID(),
    name,
    token: token(),
  })
  session.room = joined.room
  bindPlayer(socket, normalized, joined.player.id)
  broadcast(normalized)
  return {
    code: normalized,
    playerId: joined.player.id,
    token: joined.player.token,
    name: joined.player.name,
  }
}

function update(code: string, mutate: (room: Room) => Room): void {
  const session = sessions.get(code)
  if (!session) throw new GameError("Room not found")
  const ticked = applyTick(session.room, Date.now())
  let mutated: Room
  try {
    mutated = mutate(ticked)
  } catch (error) {
    if (ticked !== session.room) {
      session.room = ticked
      armTimer(code)
      broadcast(code)
    }
    throw error
  }
  session.room = applyTick(mutated, Date.now())
  armTimer(code)
  broadcast(code)
}

function broadcast(code: string): void {
  const session = sessions.get(code)
  if (!session) return
  const roomSockets = io.sockets.adapter.rooms.get(code)
  if (!roomSockets) return
  const now = Date.now()
  const addresses = lanAddresses()
  for (const socketId of roomSockets) {
    const viewer = viewers.get(socketId)
    if (!viewer || viewer.code !== code) continue
    io.to(socketId).emit(
      "state",
      snapshotFor(
        session.room,
        viewer.role === "player" ? { role: "player", playerId: viewer.playerId } : { role: "host" },
        now,
        addresses,
      ),
    )
  }
}

function armTimer(code: string): void {
  const existing = timers.get(code)
  if (existing) clearTimeout(existing)
  timers.delete(code)
  const session = sessions.get(code)
  if (!session || session.room.phase !== "question" || session.room.questionStartedAt == null) return
  const delay = Math.max(
    0,
    session.room.questionStartedAt + session.room.questionDurationMs - Date.now(),
  )
  const timer = setTimeout(() => {
    const current = sessions.get(code)
    if (!current) return
    current.room = applyTick(current.room, Date.now())
    armTimer(code)
    broadcast(code)
  }, delay)
  timers.set(code, timer)
}

function bindHost(socket: Socket, code: string): void {
  const previous = viewers.get(socket.id)
  if (previous && previous.code !== code) socket.leave(previous.code)
  socket.join(code)
  viewers.set(socket.id, { role: "host", code })
}

function bindPlayer(socket: Socket, code: string, playerId: string): void {
  const previous = viewers.get(socket.id)
  if (previous && previous.code !== code) socket.leave(previous.code)
  socket.join(code)
  viewers.set(socket.id, { role: "player", code, playerId })
  playerSockets.set(playerId, socket.id)
}

function requireHost(socket: Socket): string {
  const viewer = viewers.get(socket.id)
  if (!viewer || viewer.role !== "host") throw new GameError("Open the host screen first")
  return viewer.code
}

function requirePlayer(socket: Socket): { code: string; playerId: string } {
  const viewer = viewers.get(socket.id)
  if (!viewer || viewer.role !== "player") throw new GameError("Join a room first")
  return { code: viewer.code, playerId: viewer.playerId }
}

function respond<T>(ack: (res: Ack<T>) => void, fn: () => T): void {
  try {
    ack({ ok: true, data: fn() })
  } catch (error) {
    const message = error instanceof GameError ? error.message : "Something went wrong"
    if (!(error instanceof GameError)) console.error(error)
    ack({ ok: false, error: message })
  }
}

function uniqueCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = ""
    for (let i = 0; i < 4; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    }
    if (!sessions.has(code)) return code
  }
  throw new GameError("Could not open a room")
}

function token(): string {
  return crypto.randomUUID().replaceAll("-", "")
}

export function lanAddresses(): string[] {
  const found: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number
      if ((family === "IPv4" || family === 4) && !entry.internal) found.push(entry.address)
    }
  }
  return found
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/")
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "")
  let filePath = path.normalize(path.join(distDir, relative))
  if (filePath !== distDir && !filePath.startsWith(`${distDir}${path.sep}`)) {
    res.writeHead(403)
    res.end()
    return
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html")
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    if (path.extname(relative)) {
      res.writeHead(404)
      res.end()
      return
    }
    filePath = path.join(distDir, "index.html")
  }
  if (!existsSync(filePath)) {
    res.writeHead(404)
    res.end("Build the client first")
    return
  }
  const type = MIME[path.extname(filePath)] ?? "application/octet-stream"
  res.writeHead(200, { "content-type": type })
  res.end(readFileSync(filePath))
}
