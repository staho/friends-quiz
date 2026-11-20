import type { ErrorCode } from "./errors.ts"
export const QUESTION_DURATION_MS = 20_000
export const QUESTIONS_PER_ROUND = 10
export const BASE_POINTS = 500
export const MAX_SPEED_BONUS = 500
export const ANSWER_TIME_MIN_MS = 5_000
export const ANSWER_TIME_MAX_MS = 120_000
export const NEXT_TIME_MIN_MS = 2_000
export const NEXT_TIME_MAX_MS = 30_000
export const NEXT_TIME_DEFAULT_MS = 8_000
export const READY_DURATION_MS = 3_000
export const MAX_PLAYERS = 20
export const MAX_JOINS_PER_SOCKET = 10
export const ROOM_TTL_MS = 2 * 24 * 3600_000
export const DEAL_RETRY_MS = 5_000

export const DIFFICULTY_BANDS = ["mixed", "1-2", "2-4", "4-5"] as const
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number]

export const CHOICES = [
  { key: "A", color: "#e23b3b", ink: "#fff8f4" },
  { key: "B", color: "#2d6bff", ink: "#f4f7ff" },
  { key: "C", color: "#f0b429", ink: "#1a120c" },
  { key: "D", color: "#2f9e5f", ink: "#f3fff7" },
] as const

export type Phase = "lobby" | "ready" | "question" | "reveal" | "finished"

export type ChoiceIndex = 0 | 1 | 2 | 3

export interface PublicPlayer {
  id: string
  name: string
  score: number
  connected: boolean
  picked: boolean
  locked: boolean
  rank: number
  previousRank: number | null
}

export interface PublicReady {
  category: string
  index: number
  total: number
  remainingMs: number
  durationMs: number
}

export interface PublicQuestion {
  prompt: string
  choices: [string, string, string, string]
  index: number
  total: number
  durationMs: number
  remainingMs: number
  difficulty: number
  category: string
}

export interface RevealResult {
  playerId: string
  name: string
  choiceIndex: number | null
  correct: boolean
  points: number
  score: number
  elapsedMs: number
  locked: boolean
}

export interface PublicReveal {
  correctIndex: ChoiceIndex
  prompt: string
  choices: [string, string, string, string]
  results: RevealResult[]
  counts: [number, number, number, number]
}

export interface PlayerView {
  role: "player"
  playerId: string
  name: string
  score: number
  choiceIndex: number | null
  locked: boolean
}

export interface HostView {
  role: "host"
}

export interface GuestView {
  role: "guest"
}

export interface RoomSettings {
  questionDurationMs: number
  revealDurationMs: number
  autoAdvance: boolean
  difficulty: DifficultyBand
}

export interface RoomSnapshot {
  code: string
  phase: Phase
  players: PublicPlayer[]
  question: PublicQuestion | null
  ready: PublicReady | null
  reveal: PublicReveal | null
  you: PlayerView | HostView | GuestView
  lanAddresses: string[]
  settings: RoomSettings
  revealRemainingMs: number | null
  advancePaused: boolean
  stalled: boolean
}

export interface HostSession {
  code: string
  hostToken: string
}

export interface PlayerSession {
  code: string
  playerId: string
  token: string
  name: string
}

export type Ack<T> = { ok: true; data: T } | { ok: false; error: ErrorCode }

export interface ClientToServerEvents {
  "host:create": (ack: (res: Ack<HostSession>) => void) => void
  "host:attach": (
    payload: { code: string; hostToken: string },
    ack: (res: Ack<HostSession>) => void,
  ) => void
  "host:start": (ack: (res: Ack<null>) => void) => void
  "host:next": (ack: (res: Ack<null>) => void) => void
  "host:pause": (ack: (res: Ack<null>) => void) => void
  "host:end": (ack: (res: Ack<null>) => void) => void
  "host:reset": (ack: (res: Ack<null>) => void) => void
  "host:settings": (payload: RoomSettings, ack: (res: Ack<null>) => void) => void
  "player:join": (
    payload: { code: string; name: string },
    ack: (res: Ack<PlayerSession>) => void,
  ) => void
  "player:attach": (
    payload: { code: string; playerId: string; token: string },
    ack: (res: Ack<PlayerSession>) => void,
  ) => void
  "player:choose": (
    payload: { choiceIndex: number },
    ack: (res: Ack<null>) => void,
  ) => void
  "player:lock": (ack: (res: Ack<null>) => void) => void
  "player:leave": (ack: (res: Ack<null>) => void) => void
  "host:remove": (payload: { playerId: string }, ack: (res: Ack<null>) => void) => void
}

export interface ServerToClientEvents {
  state: (snapshot: RoomSnapshot) => void
}
