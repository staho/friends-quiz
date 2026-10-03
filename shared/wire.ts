export type ClientMessage =
  | { id: string; event: "host:attach"; payload: { code: string; hostToken: string } }
  | { id: string; event: "host:start" }
  | { id: string; event: "host:next" }
  | { id: string; event: "host:pause" }
  | { id: string; event: "host:end" }
  | { id: string; event: "host:reset" }
  | { id: string; event: "player:join"; payload: { code: string; name: string } }
  | { id: string; event: "player:attach"; payload: { code: string; playerId: string; token: string } }
  | { id: string; event: "player:choose"; payload: { choiceIndex: number } }
  | { id: string; event: "player:lock" }

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id === "") return null
  const id = value.id
  switch (value.event) {
    case "host:start":
    case "host:next":
    case "host:pause":
    case "host:end":
    case "host:reset":
    case "player:lock":
      return { id, event: value.event }
    case "host:attach": {
      const payload = value.payload
      if (!isRecord(payload) || typeof payload.code !== "string" || typeof payload.hostToken !== "string") {
        return null
      }
      return { id, event: "host:attach", payload: { code: payload.code, hostToken: payload.hostToken } }
    }
    case "player:join": {
      const payload = value.payload
      if (!isRecord(payload) || typeof payload.code !== "string" || typeof payload.name !== "string") return null
      return { id, event: "player:join", payload: { code: payload.code, name: payload.name } }
    }
    case "player:attach": {
      const payload = value.payload
      if (
        !isRecord(payload) ||
        typeof payload.code !== "string" ||
        typeof payload.playerId !== "string" ||
        typeof payload.token !== "string"
      ) {
        return null
      }
      return {
        id,
        event: "player:attach",
        payload: { code: payload.code, playerId: payload.playerId, token: payload.token },
      }
    }
    case "player:choose": {
      const payload = value.payload
      if (!isRecord(payload) || typeof payload.choiceIndex !== "number") return null
      return { id, event: "player:choose", payload: { choiceIndex: payload.choiceIndex } }
    }
    default:
      return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object"
}
