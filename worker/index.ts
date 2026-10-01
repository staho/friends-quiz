import type { HostSession } from "../shared/types.ts"
import { GameError } from "../server/game.ts"
import { CatalogDurableObject } from "./catalog.ts"
import { RoomDurableObject } from "./room.ts"

export { CatalogDurableObject, RoomDurableObject }

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/api/rooms") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
      return openRoom(env)
    }
    if (url.pathname.startsWith("/ws/")) {
      return connectRoom(request, env, url.pathname.slice("/ws/".length))
    }
    return env.ASSETS.fetch(request)
  },
}

async function openRoom(env: Env): Promise<Response> {
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomCode()
      const hostToken = crypto.randomUUID().replaceAll("-", "")
      const created = await env.ROOM.getByName(code).open({ code, hostToken })
      if (created) {
        console.log(`Room ${created.code}`)
        return Response.json(created satisfies HostSession, { status: 201 })
      }
    }
    return Response.json({ error: "Could not open a room" }, { status: 503 })
  } catch (error) {
    const message = error instanceof GameError ? error.message : "Could not open a room"
    if (!(error instanceof GameError)) console.error(error)
    return Response.json({ error: message }, { status: 500 })
  }
}

function connectRoom(request: Request, env: Env, rawCode: string): Promise<Response> | Response {
  const code = decodeURIComponent(rawCode).trim().toUpperCase()
  if (!isRoomCode(code)) return new Response("Not found", { status: 404 })
  return env.ROOM.getByName(code).fetch(request)
}

function randomCode(): string {
  let code = ""
  for (let i = 0; i < 4; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return code
}

function isRoomCode(code: string): boolean {
  return code.length === 4 && [...code].every((letter) => ALPHABET.includes(letter))
}
