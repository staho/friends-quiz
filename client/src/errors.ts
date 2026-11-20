import {
  ANSWER_TIME_MAX_MS,
  ANSWER_TIME_MIN_MS,
  NEXT_TIME_MAX_MS,
  NEXT_TIME_MIN_MS,
} from "../../shared/types.ts"
import { isErrorCode, type ErrorCode } from "../../shared/errors.ts"
import { fmt, t } from "./strings.ts"

const ERROR_TEXT: Record<ErrorCode, string> = {
  room_not_found: t.errRoomNotFound,
  rejoin: t.errRejoin,
  name_empty: t.errNameEmpty,
  name_too_long: t.errNameTooLong,
  name_taken: t.errNameTaken,
  room_full: t.errRoomFull,
  too_many_joins: t.errTooManyJoins,
  host_only: t.errHostOnly,
  join_first: t.errJoinFirst,
  no_players: t.errNoPlayers,
  already_started: t.errAlreadyStarted,
  not_started: t.errNotStarted,
  no_question_open: t.errNoQuestionOpen,
  time_up: t.errTimeUp,
  bad_choice: t.errBadChoice,
  pick_first: t.errPickFirst,
  answer_locked: t.errAnswerLocked,
  nothing_to_pause: t.errNothingToPause,
  reveal_first: t.errRevealFirst,
  no_questions: t.errNoQuestions,
  answer_time_range: fmt(t.errAnswerTimeRange, { min: ANSWER_TIME_MIN_MS / 1000, max: ANSWER_TIME_MAX_MS / 1000 }),
  next_time_range: fmt(t.errNextTimeRange, { min: NEXT_TIME_MIN_MS / 1000, max: NEXT_TIME_MAX_MS / 1000 }),
  bad_request: t.errBadRequest,
  server_error: t.errServer,
  rate_limited: t.errRateLimited,
  could_not_open_room: t.errCouldNotOpenRoom,
  reconnecting: t.errReconnecting,
  no_reply: t.errNoReply,
  unreachable: t.errUnreachable,
}

export function errorText(code: string): string {
  return isErrorCode(code) ? ERROR_TEXT[code] : t.errServer
}

/** The code carried by a QuizError (see socket.ts), else `server_error`. */
export function errorCode(err: unknown): ErrorCode {
  if (err instanceof Error && "code" in err && isErrorCode(err.code)) return err.code
  return "server_error"
}
