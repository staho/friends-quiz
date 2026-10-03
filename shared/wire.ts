import { DIFFICULTY_BANDS, type DifficultyBand, type RoomSettings } from "./types.ts"

export type ClientMessage =
  | { id: string; event: "host:attach"; payload: { code: string; hostToken: string } }
  | { id: string; event: "host:start" }
  | { id: string; event: "host:next" }
  | { id: string; event: "host:pause" }
  | { id: string; event: "host:end" }
  | { id: string; event: "host:reset" }
  | { id: string; event: "host:settings"; payload: RoomSettings }
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
    case "host:settings": {
      const payload = readSettings(value.payload)
      if (!payload) return null
      return { id, event: "host:settings", payload }
    }
    default:
      return null
  }
}

function readSettings(payload: unknown): RoomSettings | null {
  if (!isRecord(payload)) return null
  if (typeof payload.questionDurationMs !== "number" || typeof payload.revealDurationMs !== "number") return null
  if (typeof payload.autoAdvance !== "boolean" || !isDifficultyBand(payload.difficulty)) return null
  return {
    questionDurationMs: payload.questionDurationMs,
    revealDurationMs: payload.revealDurationMs,
    autoAdvance: payload.autoAdvance,
    difficulty: payload.difficulty,
  }
}

function isDifficultyBand(value: unknown): value is DifficultyBand {
  return typeof value === "string" && DIFFICULTY_BANDS.some((band) => band === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object"
}
