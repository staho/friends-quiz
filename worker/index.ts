import type { ErrorCode } from "../shared/errors.ts"
import type { HostSession } from "../shared/types.ts"
import { GameError } from "../server/game.ts"
import { clientKey, parseRoomPath, randomCode } from "../server/http.ts"
import { CatalogDurableObject } from "./catalog.ts"
import { RoomDurableObject } from "./room.ts"

export { CatalogDurableObject, RoomDurableObject }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/api/rooms") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
      const limit = await env.ROOM_LIMIT?.limit({ key: clientKey(request) })
      if (limit && !limit.success) {
        return Response.json({ error: "rate_limited" satisfies ErrorCode }, { status: 429 })
      }
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
    return Response.json({ error: "could_not_open_room" satisfies ErrorCode }, { status: 503 })
  } catch (error) {
    const code: ErrorCode = error instanceof GameError ? error.code : "could_not_open_room"
    if (!(error instanceof GameError)) console.error(error)
    return Response.json({ error: code }, { status: 500 })
  }
}

function connectRoom(request: Request, env: Env, rawCode: string): Promise<Response> | Response {
  const code = parseRoomPath(rawCode)
  if (!code) return new Response("Bad request", { status: 400 })
  return env.ROOM.getByName(code).fetch(request)
}
