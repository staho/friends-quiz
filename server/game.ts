import {
  ANSWER_TIME_MAX_MS,
  ANSWER_TIME_MIN_MS,
  BASE_POINTS,
  MAX_SPEED_BONUS,
  NEXT_TIME_DEFAULT_MS,
  NEXT_TIME_MAX_MS,
  NEXT_TIME_MIN_MS,
  QUESTION_DURATION_MS,
  QUESTIONS_PER_ROUND,
  READY_DURATION_MS,
  type ChoiceIndex,
  type DifficultyBand,
  type HostView,
  type Phase,
  type PlayerView,
  type PublicReady,
  type PublicReveal,
  type RevealResult,
  type RoomSettings,
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

export interface SeenQuestion {
  id: string
  difficulty: number
}

export interface Room {
  code: string
  hostToken: string
  players: Player[]
  asked: Question[]
  seen: SeenQuestion[]
  history: AnswerRecord[]
  questionLimit: number
  questionIndex: number
  phase: Phase
  questionStartedAt: number | null
  readyUntil: number | null
  questionDurationMs: number
  revealDurationMs: number
  autoAdvance: boolean
  difficulty: DifficultyBand
  advanceAt: number | null
  advancePaused: boolean
  advanceRemainingMs: number | null
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

export function difficultyForSlot(askedCount: number): number {
  if (askedCount < 0) return 1
  return Math.min(5, Math.floor(askedCount / 2) + 1)
}

export function dealExcludeIds(room: Room): string[] {
  const ids = new Set<string>()
  for (const item of room.seen) ids.add(item.id)
  for (const question of room.asked) ids.add(question.id)
  return [...ids]
}

export function releaseDifficulty(room: Room, difficulty: number): Room {
  const kept = room.seen.filter((item) => item.difficulty !== difficulty)
  const stillOut = room.asked
    .filter((question) => question.difficulty === difficulty)
    .filter((question) => kept.every((item) => item.id !== question.id))
    .map((question) => ({ id: question.id, difficulty: question.difficulty }))
  return { ...room, seen: [...kept, ...stillOut] }
}

export async function takeFromDeck(
  room: Room,
  target: number,
  bounds: { minDifficulty: number; maxDifficulty: number } | null,
  pick: (
    excludeIds: string[],
    difficulty: number,
    bounds?: { minDifficulty: number; maxDifficulty: number },
  ) => Promise<Question | null>,
): Promise<{ room: Room; question: Question | null }> {
  const exact = { minDifficulty: target, maxDifficulty: target }
  const first = await pick(dealExcludeIds(room), target, exact)
  if (first) return { room, question: first }
  const deck = releaseDifficulty(room, target)
  const second = await pick(dealExcludeIds(deck), target, bounds ?? undefined)
  return { room: deck, question: second }
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
    seen: [],
    history: [],
    questionLimit,
    questionIndex: 0,
    phase: "lobby",
    questionStartedAt: null,
    readyUntil: null,
    questionDurationMs: options.questionDurationMs ?? QUESTION_DURATION_MS,
    revealDurationMs: NEXT_TIME_DEFAULT_MS,
    autoAdvance: true,
    difficulty: "mixed",
    advanceAt: null,
    advancePaused: false,
    advanceRemainingMs: null,
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
    seen: readSeen(value.seen),
    history: value.history ?? [],
    questionLimit: value.questionLimit ?? (legacy?.length || QUESTIONS_PER_ROUND),
    questionIndex: value.questionIndex ?? 0,
    phase,
    questionStartedAt: value.questionStartedAt ?? null,
    readyUntil: readReadyUntil(phase, value.readyUntil),
    questionDurationMs: value.questionDurationMs ?? QUESTION_DURATION_MS,
    revealDurationMs: readRevealDuration(value.revealDurationMs),
    autoAdvance: value.autoAdvance !== false,
    difficulty: readDifficultyBand(value.difficulty),
    ...readAdvance(value),
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
  if (phase === "ready" || phase === "question" || phase === "reveal" || phase === "finished") return phase
  return "lobby"
}

function readReadyUntil(phase: Room["phase"], value: number | null | undefined): number | null {
  if (phase !== "ready") return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  return 0
}

function readLegacyQuestions(value: StoredRoom): Question[] | null {
  return Array.isArray(value.questions) ? value.questions : null
}

function readRoundId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function readPendingPlays(value: unknown): PendingPlay[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const play = readPendingPlay(item)
    return play ? [play] : []
  })
}

function readPendingPlay(item: unknown): PendingPlay | null {
  if (!item || typeof item !== "object") return null
  const play = item as Partial<PendingPlay>
  if (!isPlayText(play.playId) || !isPlayText(play.questionId)) return null
  if (!isPlayCount(play.correct) || !isPlayCount(play.incorrect)) return null
  return {
    playId: play.playId,
    questionId: play.questionId,
    correct: play.correct,
    incorrect: play.incorrect,
  }
}

function isPlayText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isPlayCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function readRevealDuration(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < NEXT_TIME_MIN_MS || value > NEXT_TIME_MAX_MS) {
    return NEXT_TIME_DEFAULT_MS
  }
  return value
}

function readDifficultyBand(value: DifficultyBand | undefined): DifficultyBand {
  if (value === "1-2" || value === "2-4" || value === "4-5") return value
  return "mixed"
}

function readAdvanceAt(autoAdvance: boolean, value: number | null | undefined): number | null {
  if (!autoAdvance || typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}

function readAsked(value: StoredRoom, phase: Room["phase"], legacy: Question[] | null): Question[] {
  if (Array.isArray(value.asked)) return value.asked
  if (!legacy || phase === "lobby") return []
  return legacy.slice(0, (value.questionIndex ?? 0) + 1)
}

function readSeen(value: unknown): SeenQuestion[] {
  if (!Array.isArray(value)) return []
  const seen: SeenQuestion[] = []
  for (const item of value) {
    const entry = readSeenQuestion(item)
    if (!entry || seen.some((existing) => existing.id === entry.id)) continue
    seen.push(entry)
  }
  return seen
}

function readSeenQuestion(item: unknown): SeenQuestion | null {
  if (!item || typeof item !== "object") return null
  const entry = item as Partial<SeenQuestion>
  if (typeof entry.id !== "string" || entry.id.length === 0) return null
  if (typeof entry.difficulty !== "number" || !Number.isInteger(entry.difficulty)) return null
  if (entry.difficulty < 1 || entry.difficulty > 5) return null
  return { id: entry.id, difficulty: entry.difficulty }
}

function rememberQuestion(seen: SeenQuestion[], question: Question): SeenQuestion[] {
  if (seen.some((item) => item.id === question.id)) return seen
  return [...seen, { id: question.id, difficulty: question.difficulty }]
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

export function withLiveConnections(room: Room, livePlayerIds: ReadonlySet<string>): Room {
  let next = room
  for (const player of room.players) {
    if (player.connected && !livePlayerIds.has(player.id)) {
      next = setPlayerConnected(next, player.id, false)
    }
  }
  return next
}

export function startGame(room: Room, question: Question, now: number, roundId: string = crypto.randomUUID()): Room {
  if (room.phase !== "lobby") throw new GameError("The round has already started")
  if (room.players.length === 0) throw new GameError("Wait for at least one player")
  return {
    ...room,
    asked: [question],
    seen: rememberQuestion(room.seen, question),
    history: [],
    questionIndex: 0,
    ...armReady(now),
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

export function updateSettings(room: Room, input: RoomSettings, now: number): Room {
  const questionDurationMs = readSettingDuration(
    input.questionDurationMs,
    ANSWER_TIME_MIN_MS,
    ANSWER_TIME_MAX_MS,
    "Answer time",
  )
  const revealDurationMs = readSettingDuration(
    input.revealDurationMs,
    NEXT_TIME_MIN_MS,
    NEXT_TIME_MAX_MS,
    "Time to the next question",
  )
  if (typeof input.autoAdvance !== "boolean") throw new GameError("Choose whether to advance automatically")
  const difficulty = requireDifficultyBand(input.difficulty)
  const next: Room = {
    ...room,
    questionDurationMs,
    revealDurationMs,
    autoAdvance: input.autoAdvance,
    difficulty,
  }
  if (room.phase !== "reveal") return next
  const timingChanged = room.autoAdvance !== next.autoAdvance || room.revealDurationMs !== next.revealDurationMs
  if (!timingChanged) return next
  return {
    ...next,
    ...stoppedAdvance(),
    advanceAt: next.autoAdvance ? now + next.revealDurationMs : null,
  }
}

export function toggleAdvancePause(room: Room, now: number): Room {
  if (room.phase !== "reveal" || !room.autoAdvance) throw new GameError("Nothing to pause")
  if (!room.advancePaused) {
    return {
      ...room,
      advancePaused: true,
      advanceAt: null,
      advanceRemainingMs: holdLeft(room, now),
    }
  }
  const remaining = room.advanceRemainingMs ?? 0
  return {
    ...room,
    advancePaused: false,
    advanceAt: now + remaining,
    advanceRemainingMs: null,
  }
}

export function advanceDue(room: Room, now: number): boolean {
  return (
    room.phase === "reveal" &&
    room.autoAdvance &&
    !room.advancePaused &&
    room.advanceAt != null &&
    now >= room.advanceAt
  )
}

export function alarmAt(room: Room): number | null {
  if (room.phase === "ready" && room.readyUntil != null) return room.readyUntil
  if (room.phase === "question" && room.questionStartedAt != null) {
    return room.questionStartedAt + room.questionDurationMs
  }
  if (room.phase === "reveal" && room.autoAdvance && room.advanceAt != null) return room.advanceAt
  return null
}

export function difficultyBounds(band: DifficultyBand): { minDifficulty: number; maxDifficulty: number } | null {
  if (band === "1-2") return { minDifficulty: 1, maxDifficulty: 2 }
  if (band === "2-4") return { minDifficulty: 2, maxDifficulty: 4 }
  if (band === "4-5") return { minDifficulty: 4, maxDifficulty: 5 }
  return null
}

export function applyTick(room: Room, now: number): Room {
  if (room.phase === "ready") {
    if (room.readyUntil == null || now < room.readyUntil) return room
    return openQuestion(room, now)
  }
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
      elapsedMs,
      locked: answer?.locked === true,
    }
  })

  return queueRevealedPlay(
    {
      ...room,
      phase: "reveal",
      questionStartedAt: null,
      readyUntil: null,
      ...stoppedAdvance(),
      advanceAt: room.autoAdvance ? now + room.revealDurationMs : null,
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
      readyUntil: null,
      ...stoppedAdvance(),
      answers: {},
    }
  }
  return {
    ...room,
    asked: [...room.asked, question],
    seen: rememberQuestion(room.seen, question),
    questionIndex: room.asked.length,
    ...armReady(now),
    ...stoppedAdvance(),
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
    readyUntil: null,
    ...stoppedAdvance(),
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
    readyUntil: null,
    ...stoppedAdvance(),
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
          difficulty: question.difficulty,
        }
      : null,
    ready: readyView(room, now),
    reveal: room.phase === "reveal" || room.phase === "finished" ? room.reveal : null,
    you,
    lanAddresses,
    settings: roomSettings(room),
    revealRemainingMs: revealWaitMs(room, now),
    advancePaused: room.phase === "reveal" && room.advancePaused,
  }
}

export function normalizeName(input: string): string {
  const name = input.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim()
  if (!name) throw new GameError("Enter a name")
  if (name.length > MAX_NAME_LENGTH) throw new GameError("Use a shorter name")
  return name
}

function armReady(now: number): Pick<Room, "phase" | "questionStartedAt" | "readyUntil"> {
  return {
    phase: "ready",
    questionStartedAt: null,
    readyUntil: now + READY_DURATION_MS,
  }
}

function openQuestion(room: Room, now: number): Room {
  return {
    ...room,
    phase: "question",
    questionStartedAt: now,
    readyUntil: null,
  }
}

function readyView(room: Room, now: number): PublicReady | null {
  if (room.phase !== "ready" || room.readyUntil == null) return null
  return {
    index: room.questionIndex,
    total: room.questionLimit,
    remainingMs: Math.max(0, room.readyUntil - now),
    durationMs: READY_DURATION_MS,
  }
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

function roomSettings(room: Room): RoomSettings {
  return {
    questionDurationMs: room.questionDurationMs,
    revealDurationMs: room.revealDurationMs,
    autoAdvance: room.autoAdvance,
    difficulty: room.difficulty,
  }
}

function stoppedAdvance(): Pick<Room, "advanceAt" | "advancePaused" | "advanceRemainingMs"> {
  return { advanceAt: null, advancePaused: false, advanceRemainingMs: null }
}

function readAdvance(value: StoredRoom): Pick<Room, "advanceAt" | "advancePaused" | "advanceRemainingMs"> {
  const autoAdvance = value.autoAdvance !== false
  const advancePaused = autoAdvance && value.advancePaused === true
  if (!advancePaused) return { ...stoppedAdvance(), advanceAt: readAdvanceAt(autoAdvance, value.advanceAt) }
  return {
    advancePaused: true,
    advanceAt: null,
    advanceRemainingMs: readOptionalMs(value.advanceRemainingMs) ?? 0,
  }
}

function readOptionalMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, value)
}

function holdLeft(room: Room, now: number): number {
  if (room.advancePaused) return room.advanceRemainingMs ?? 0
  if (room.advanceAt == null) return 0
  return Math.max(0, room.advanceAt - now)
}

function revealWaitMs(room: Room, now: number): number | null {
  if (room.phase !== "reveal" || !room.autoAdvance) return null
  if (room.advancePaused) return room.advanceRemainingMs ?? 0
  if (room.advanceAt == null) return null
  return Math.max(0, room.advanceAt - now)
}

function readSettingDuration(value: number, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new GameError(`${label} needs to be between ${min / 1000} and ${max / 1000} seconds`)
  }
  return value
}

function requireDifficultyBand(value: unknown): DifficultyBand {
  if (value === "mixed" || value === "1-2" || value === "2-4" || value === "4-5") return value
  throw new GameError("Pick a difficulty")
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
