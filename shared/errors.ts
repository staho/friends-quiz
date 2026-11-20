export const ERROR_CODES = [
  "room_not_found", "rejoin", "name_empty", "name_too_long", "name_taken", "room_full",
  "too_many_joins", "host_only", "join_first", "no_players", "already_started", "not_started",
  "no_question_open", "time_up", "bad_choice", "pick_first", "answer_locked", "nothing_to_pause",
  "reveal_first", "no_questions", "answer_time_range", "next_time_range", "bad_request",
  "server_error", "rate_limited", "could_not_open_room",
  // client-only
  "reconnecting", "no_reply", "unreachable",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value)
}
