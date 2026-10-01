import {
  BASE_POINTS,
  MAX_SPEED_BONUS,
  QUESTION_DURATION_MS,
  QUESTIONS_PER_ROUND,
  type ChoiceIndex,
  type HostView,
  type PlayerView,
  type PublicReveal,
  type RevealResult,
  type RoomSnapshot,
} from "../shared/types.ts"

export class GameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GameError"
  }
}

export interface Question {
  id: string
  prompt: string
  choices: [string, string, string, string]
  correctIndex: ChoiceIndex
  category: string
  difficulty: number
}

export interface AnswerRecord {
  playerId: string
  questionId: string
  category: string
  difficulty: number
  correct: boolean
  elapsedMs: number
}

export interface RoundStats {
  askedIds: string[]
  answers: AnswerRecord[]
  players: { id: string; score: number }[]
}

export type QuestionPolicy = (
  candidates: readonly Question[],
  stats: RoundStats,
  rng?: () => number,
) => Question

export interface Player {
  id: string
  name: string
  score: number
  connected: boolean
  token: string
}

export interface PlayerAnswer {
  choiceIndex: ChoiceIndex
  locked: boolean
  elapsedMs: number | null
}

export interface PendingPlay {
  playId: string
  questionId: string
  correct: number
  incorrect: number
}

export interface Room {
  code: string
  hostToken: string
  players: Player[]
  asked: Question[]
  history: AnswerRecord[]
  questionLimit: number
  questionIndex: number
  phase: "lobby" | "question" | "reveal" | "finished"
  questionStartedAt: number | null
  questionDurationMs: number
  answers: Record<string, PlayerAnswer>
  reveal: PublicReveal | null
  roundId: string | null
  pendingPlays: PendingPlay[]
}

export interface Viewer {
  role: "host" | "player"
  playerId?: string
}

const MAX_NAME_LENGTH = 16

export function scoreAnswer(correct: boolean, elapsedMs: number, durationMs: number): number {
  if (!correct || durationMs <= 0) return 0
  const clamped = Math.min(Math.max(elapsedMs, 0), durationMs)
  const speedRatio = 1 - clamped / durationMs
  return BASE_POINTS + Math.round(speedRatio * MAX_SPEED_BONUS)
}

export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const current = copy[i]
    const swap = copy[j]
    if (current === undefined || swap === undefined) continue
    copy[i] = swap
    copy[j] = current
  }
  return copy
}

export const randomQuestionPolicy: QuestionPolicy = (candidates, stats, rng = Math.random) => {
  const asked = new Set(stats.askedIds)
  const unseen = candidates.filter((question) => !asked.has(question.id))
  if (unseen.length === 0) throw new GameError("No questions available")
  const picked = shuffle(unseen, rng)[0]
  if (!picked) throw new GameError("No questions available")
  return picked
}

export function roundStats(room: Room): RoundStats {
  return {
    askedIds: room.asked.map((question) => question.id),
    answers: room.history,
    players: room.players.map((player) => ({ id: player.id, score: player.score })),
  }
}

export function createRoom(options: {
  code: string
  hostToken: string
  questionLimit?: number
  questionDurationMs?: number
}): Room {
  const questionLimit = options.questionLimit ?? QUESTIONS_PER_ROUND
  if (questionLimit < 1) throw new GameError("A round needs at least one question")
  return {
    code: options.code,
    hostToken: options.hostToken,
    players: [],
    asked: [],
    history: [],
    questionLimit,
    questionIndex: 0,
    phase: "lobby",
    questionStartedAt: null,
    questionDurationMs: options.questionDurationMs ?? QUESTION_DURATION_MS,
    answers: {},
    reveal: null,
    roundId: null,
    pendingPlays: [],
  }
}

type StoredRoom = Partial<Room> & { questions?: Question[] }

export function restoreRoom(raw: unknown): Room {
  const value = readStoredRoom(raw)
  const phase = readPhase(value.phase)
  const legacy = readLegacyQuestions(value)
  return {
    code: value.code,
    hostToken: value.hostToken,
    players: value.players ?? [],
    asked: readAsked(value, phase, legacy),
    history: value.history ?? [],
    questionLimit: value.questionLimit ?? (legacy?.length || QUESTIONS_PER_ROUND),
    questionIndex: value.questionIndex ?? 0,
    phase,
    questionStartedAt: value.questionStartedAt ?? null,
    questionDurationMs: value.questionDurationMs ?? QUESTION_DURATION_MS,
    answers: value.answers ?? {},
    reveal: value.reveal ?? null,
    roundId: readRoundId(value.roundId),
    pendingPlays: readPendingPlays(value.pendingPlays),
  }
}

function readStoredRoom(raw: unknown): StoredRoom & { code: string; hostToken: string } {
  if (!raw || typeof raw !== "object") throw new GameError("Room not found")
  const value = raw as StoredRoom
  const code = value.code
  const hostToken = value.hostToken
  if (typeof code !== "string" || typeof hostToken !== "string") {
    throw new GameError("Room not found")
  }
  return { ...value, code, hostToken }
}

function readPhase(phase: Room["phase"] | undefined): Room["phase"] {
  if (phase === "question" || phase === "reveal" || phase === "finished") return phase
  return "lobby"
}

function readLegacyQuestions(value: StoredRoom): Question[] | null {
  return Array.isArray(value.questions) ? value.questions : null
}

function readRoundId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function readPendingPlays(value: PendingPlay[] | undefined): PendingPlay[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const play = item as Partial<PendingPlay>
    if (typeof play.playId !== "string" || play.playId.length === 0) return []
    if (typeof play.questionId !== "string" || play.questionId.length === 0) return []
    if (!isPlayCount(play.correct) || !isPlayCount(play.incorrect)) return []
    return [
      {
        playId: play.playId,
        questionId: play.questionId,
        correct: play.correct,
        incorrect: play.incorrect,
      },
    ]
  })
}

function isPlayCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function readAsked(value: StoredRoom, phase: Room["phase"], legacy: Question[] | null): Question[] {
  if (Array.isArray(value.asked)) return value.asked
  if (!legacy || phase === "lobby") return []
  return legacy.slice(0, (value.questionIndex ?? 0) + 1)
}

export function joinPlayer(
  room: Room,
  input: { id: string; name: string; token: string },
): { room: Room; player: Player } {
  const name = normalizeName(input.name)
  const byToken = room.players.find((player) => player.token === input.token)
  if (byToken) {
    const player = { ...byToken, connected: true }
    return { room: replacePlayer(room, player), player }
  }

  const byName = room.players.find((player) => player.name.toLowerCase() === name.toLowerCase())
  if (byName) {
    if (!byName.connected) {
      const player = { ...byName, connected: true, token: input.token }
      return { room: replacePlayer(room, player), player }
    }
    throw new GameError("That name is taken")
  }

  if (room.phase !== "lobby") throw new GameError("This round has already started")

  const player: Player = {
    id: input.id,
    name,
    score: 0,
    connected: true,
    token: input.token,
  }
  return { room: { ...room, players: [...room.players, player] }, player }
}

export function reconnectPlayer(room: Room, playerId: string, token: string): Room {
  const player = room.players.find((item) => item.id === playerId)
  if (!player || player.token !== token) throw new GameError("Rejoin the room")
  return replacePlayer(room, { ...player, connected: true })
}

export function setPlayerConnected(room: Room, playerId: string, connected: boolean): Room {
  const player = room.players.find((item) => item.id === playerId)
  if (!player) return room
  return replacePlayer(room, { ...player, connected })
}

export function startGame(room: Room, question: Question, now: number, roundId: string = crypto.randomUUID()): Room {
  if (room.phase !== "lobby") throw new GameError("The round has already started")
  if (room.players.length === 0) throw new GameError("Wait for at least one player")
  return {
    ...room,
    asked: [question],
    history: [],
    questionIndex: 0,
    phase: "question",
    questionStartedAt: now,
    answers: {},
    reveal: null,
    roundId,
  }
}

export function submitChoice(room: Room, playerId: string, choiceIndex: number, now: number): Room {
  assertQuestionOpen(room, now)
  requirePlayer(room, playerId)
  if (!isChoiceIndex(choiceIndex)) throw new GameError("Pick one of the four answers")
  const current = room.answers[playerId]
  if (current?.locked) throw new GameError("Answer is locked")
  return {
    ...room,
    answers: {
      ...room.answers,
      [playerId]: { choiceIndex, locked: false, elapsedMs: null },
    },
  }
}

export function lockAnswer(room: Room, playerId: string, now: number): Room {
  assertQuestionOpen(room, now)
  requirePlayer(room, playerId)
  const current = room.answers[playerId]
  if (!current) throw new GameError("Pick an answer first")
  if (current.locked) return room
  return {
    ...room,
    answers: {
      ...room.answers,
      [playerId]: { ...current, locked: true, elapsedMs: elapsed(room, now) },
    },
  }
}

export function applyTick(room: Room, now: number): Room {
  if (room.phase !== "question" || room.questionStartedAt == null) return room
  const deadline = room.questionStartedAt + room.questionDurationMs
  const connected = room.players.filter((player) => player.connected)
  const allLocked =
    connected.length > 0 && connected.every((player) => room.answers[player.id]?.locked === true)
  if (now >= deadline || allLocked) return reveal(room, now)
  return room
}

export function reveal(room: Room, now: number): Room {
  if (room.phase !== "question" || room.questionStartedAt == null) {
    throw new GameError("No question is open")
  }
  const question = currentQuestion(room)
  const elapsedNow = Math.min(
    room.questionDurationMs,
    Math.max(0, now - room.questionStartedAt),
  )
  const history: AnswerRecord[] = []
  const results: RevealResult[] = room.players.map((player) => {
    const answer = room.answers[player.id]
    const choiceIndex = answer?.choiceIndex ?? null
    const correct = choiceIndex === question.correctIndex
    const elapsedMs =
      answer == null
        ? room.questionDurationMs
        : answer.locked && answer.elapsedMs != null
          ? answer.elapsedMs
          : elapsedNow
    const points = answer ? scoreAnswer(correct, elapsedMs, room.questionDurationMs) : 0
    history.push({
      playerId: player.id,
      questionId: question.id,
      category: question.category,
      difficulty: question.difficulty,
      correct: answer != null && correct,
      elapsedMs,
    })
    return {
      playerId: player.id,
      name: player.name,
      choiceIndex,
      correct: answer != null && correct,
      points,
      score: player.score + points,
    }
  })

  return queueRevealedPlay(
    {
      ...room,
      phase: "reveal",
      questionStartedAt: null,
      history: [...room.history, ...history],
      players: room.players.map((player) => {
        const result = results.find((item) => item.playerId === player.id)
        return result ? { ...player, score: result.score } : player
      }),
      reveal: {
        correctIndex: question.correctIndex,
        prompt: question.prompt,
        choices: question.choices,
        results,
      },
    },
    question,
    results,
  )
}

export function nextQuestion(room: Room, question: Question | null, now: number): Room {
  if (room.phase !== "reveal") throw new GameError("Reveal the answer before moving on")
  if (question == null || room.asked.length >= room.questionLimit) {
    return {
      ...room,
      phase: "finished",
      questionStartedAt: null,
      answers: {},
    }
  }
  return {
    ...room,
    asked: [...room.asked, question],
    questionIndex: room.asked.length,
    phase: "question",
    questionStartedAt: now,
    answers: {},
    reveal: null,
  }
}

export function endGame(room: Room): Room {
  if (room.phase === "lobby") throw new GameError("The round has not started")
  if (room.phase === "finished") return room
  return {
    ...room,
    phase: "finished",
    questionStartedAt: null,
    answers: {},
  }
}

export function resetRound(room: Room): Room {
  return {
    ...room,
    players: room.players.map((player) => ({ ...player, score: 0 })),
    asked: [],
    history: [],
    questionIndex: 0,
    phase: "lobby",
    questionStartedAt: null,
    answers: {},
    reveal: null,
    roundId: null,
  }
}

export function snapshotFor(room: Room, viewer: Viewer, now: number, lanAddresses: string[]): RoomSnapshot {
  const question = room.phase === "question" ? currentQuestion(room) : null
  const you: PlayerView | HostView =
    viewer.role === "player" && viewer.playerId
      ? playerView(room, viewer.playerId)
      : { role: "host" }

  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      connected: player.connected,
      picked: room.answers[player.id] != null,
      locked: room.answers[player.id]?.locked === true,
    })),
    question: question
      ? {
          prompt: question.prompt,
          choices: question.choices,
          index: room.questionIndex,
          total: room.questionLimit,
          durationMs: room.questionDurationMs,
          remainingMs: remainingMs(room, now),
        }
      : null,
    reveal: room.phase === "reveal" || room.phase === "finished" ? room.reveal : null,
    you,
    lanAddresses,
  }
}

export function normalizeName(input: string): string {
  const name = input.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim()
  if (!name) throw new GameError("Enter a name")
  if (name.length > MAX_NAME_LENGTH) throw new GameError("Use a shorter name")
  return name
}

function playerView(room: Room, playerId: string): PlayerView {
  const player = room.players.find((item) => item.id === playerId)
  if (!player) throw new GameError("Rejoin the room")
  const answer = room.answers[playerId]
  return {
    role: "player",
    playerId: player.id,
    name: player.name,
    score: player.score,
    choiceIndex: answer?.choiceIndex ?? null,
    locked: answer?.locked === true,
  }
}

function queueRevealedPlay(room: Room, question: Question, results: readonly RevealResult[]): Room {
  const roundId = room.roundId ?? crypto.randomUUID()
  const playId = `${room.code}:${roundId}:${question.id}`
  const correct = results.filter((result) => result.correct).length
  const incorrect = results.filter((result) => result.choiceIndex != null && !result.correct).length
  if (room.pendingPlays.some((play) => play.playId === playId)) return { ...room, roundId }
  return {
    ...room,
    roundId,
    pendingPlays: [
      ...room.pendingPlays,
      { playId, questionId: question.id, correct, incorrect },
    ],
  }
}

function currentQuestion(room: Room): Question {
  const question = room.asked[room.questionIndex]
  if (!question) throw new GameError("No question is open")
  return question
}

function remainingMs(room: Room, now: number): number {
  if (room.questionStartedAt == null) return 0
  return Math.max(0, room.questionStartedAt + room.questionDurationMs - now)
}

function elapsed(room: Room, now: number): number {
  if (room.questionStartedAt == null) return room.questionDurationMs
  return Math.min(room.questionDurationMs, Math.max(0, now - room.questionStartedAt))
}

function assertQuestionOpen(room: Room, now: number): void {
  if (room.phase !== "question" || room.questionStartedAt == null) {
    throw new GameError("No question is open")
  }
  if (now >= room.questionStartedAt + room.questionDurationMs) {
    throw new GameError("Time is up")
  }
}

function requirePlayer(room: Room, playerId: string): Player {
  const player = room.players.find((item) => item.id === playerId)
  if (!player) throw new GameError("Rejoin the room")
  return player
}

function replacePlayer(room: Room, player: Player): Room {
  return {
    ...room,
    players: room.players.map((item) => (item.id === player.id ? player : item)),
  }
}

function isChoiceIndex(value: number): value is ChoiceIndex {
  return value === 0 || value === 1 || value === 2 || value === 3
}
