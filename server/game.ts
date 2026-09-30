import {
  BASE_POINTS,
  MAX_SPEED_BONUS,
  QUESTION_DURATION_MS,
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
}

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

export interface Room {
  code: string
  hostToken: string
  players: Player[]
  questions: Question[]
  questionIndex: number
  phase: "lobby" | "question" | "reveal" | "finished"
  questionStartedAt: number | null
  questionDurationMs: number
  answers: Record<string, PlayerAnswer>
  reveal: PublicReveal | null
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

export function selectRound(
  questions: readonly Question[],
  count: number,
  rng: () => number = Math.random,
): Question[] {
  if (questions.length === 0) throw new GameError("No questions available")
  if (count < 1) throw new GameError("A round needs at least one question")
  return shuffle(questions, rng).slice(0, Math.min(count, questions.length))
}

export function createRoom(options: {
  code: string
  hostToken: string
  questions: Question[]
  questionDurationMs?: number
}): Room {
  if (options.questions.length === 0) throw new GameError("No questions available")
  return {
    code: options.code,
    hostToken: options.hostToken,
    players: [],
    questions: options.questions,
    questionIndex: 0,
    phase: "lobby",
    questionStartedAt: null,
    questionDurationMs: options.questionDurationMs ?? QUESTION_DURATION_MS,
    answers: {},
    reveal: null,
  }
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

export function startGame(room: Room, now: number): Room {
  if (room.phase !== "lobby") throw new GameError("The round has already started")
  if (room.players.length === 0) throw new GameError("Wait for at least one player")
  return {
    ...room,
    phase: "question",
    questionIndex: 0,
    questionStartedAt: now,
    answers: {},
    reveal: null,
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
    return {
      playerId: player.id,
      name: player.name,
      choiceIndex,
      correct: answer != null && correct,
      points,
      score: player.score + points,
    }
  })

  return {
    ...room,
    phase: "reveal",
    questionStartedAt: null,
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
  }
}

export function nextQuestion(room: Room, now: number): Room {
  if (room.phase !== "reveal") throw new GameError("Reveal the answer before moving on")
  const nextIndex = room.questionIndex + 1
  if (nextIndex >= room.questions.length) {
    return {
      ...room,
      phase: "finished",
      questionStartedAt: null,
      answers: {},
    }
  }
  return {
    ...room,
    questionIndex: nextIndex,
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

export function resetRound(room: Room, questions: Question[]): Room {
  if (questions.length === 0) throw new GameError("No questions available")
  return {
    ...room,
    players: room.players.map((player) => ({ ...player, score: 0 })),
    questions,
    questionIndex: 0,
    phase: "lobby",
    questionStartedAt: null,
    answers: {},
    reveal: null,
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
          total: room.questions.length,
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

function currentQuestion(room: Room): Question {
  const question = room.questions[room.questionIndex]
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
