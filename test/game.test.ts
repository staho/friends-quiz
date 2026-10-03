import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BASE_POINTS, MAX_SPEED_BONUS, NEXT_TIME_DEFAULT_MS, type RoomSettings } from "../shared/types.ts"
import {
  GameError,
  advanceDue,
  alarmAt,
  applyTick,
  createRoom,
  difficultyBounds,
  difficultyForSlot,
  endGame,
  joinPlayer,
  lockAnswer,
  nextQuestion,
  randomQuestionPolicy,
  resetRound,
  restoreRoom,
  scoreAnswer,
  snapshotFor,
  startGame,
  submitChoice,
  updateSettings,
  type Question,
  type Room,
} from "../server/game.ts"

const duration = 20_000

function question(id: string, correctIndex: 0 | 1 | 2 | 3): Question {
  return {
    id,
    prompt: `Prompt ${id}`,
    choices: ["Red", "Blue", "Gold", "Green"],
    correctIndex,
    category: "general",
    difficulty: 1,
  }
}

function roomWith(): Room {
  return createRoom({
    code: "QUIZ",
    hostToken: "host",
    questionDurationMs: duration,
  })
}

function addPlayer(room: Room, id: string, name: string): Room {
  return joinPlayer(room, { id, name, token: `token-${id}` }).room
}

function settings(overrides: Partial<RoomSettings> = {}): RoomSettings {
  return {
    questionDurationMs: duration,
    revealDurationMs: NEXT_TIME_DEFAULT_MS,
    autoAdvance: true,
    difficulty: "mixed",
    ...overrides,
  }
}

describe("scoring", () => {
  it("gives a wrong answer nothing", () => {
    assert.equal(scoreAnswer(false, 0, duration), 0)
  })

  it("gives an instant correct answer the full speed bonus", () => {
    assert.equal(scoreAnswer(true, 0, duration), BASE_POINTS + MAX_SPEED_BONUS)
  })

  it("gives a last-moment correct answer the base only", () => {
    assert.equal(scoreAnswer(true, duration, duration), BASE_POINTS)
  })

  it("splits the speed bonus halfway through", () => {
    assert.equal(scoreAnswer(true, duration / 2, duration), BASE_POINTS + MAX_SPEED_BONUS / 2)
  })
})

describe("joining", () => {
  it("adds a player in the lobby", () => {
    const room = addPlayer(roomWith(), "p1", "Ada")
    assert.equal(room.players.length, 1)
    assert.equal(room.players[0]?.name, "Ada")
  })

  it("rejects an empty name", () => {
    assert.throws(() => addPlayer(roomWith(), "p1", "   "), GameError)
  })

  it("rejects a duplicate name while that player is connected", () => {
    const room = addPlayer(roomWith(), "p1", "Ada")
    assert.throws(() => addPlayer(room, "p2", "ada"), /taken/)
  })

  it("lets a disconnected player reclaim the same name", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = { ...room, players: room.players.map((player) => ({ ...player, connected: false })) }
    const rejoined = joinPlayer(room, { id: "p2", name: "Ada", token: "new" })
    assert.equal(rejoined.player.id, "p1")
    assert.equal(rejoined.player.token, "new")
    assert.equal(rejoined.player.connected, true)
  })

  it("refuses a new player after the round starts", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    assert.throws(() => addPlayer(room, "p2", "Bea"), /already started/)
  })
})

describe("answers", () => {
  it("keeps one answer per player and lets them change it until lock", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = startGame(room, question("a", 0), 1_000)
    room = submitChoice(room, "p1", 1, 1_200)
    room = submitChoice(room, "p1", 0, 1_400)
    room = submitChoice(room, "p2", 3, 1_500)
    room = lockAnswer(room, "p1", 2_000)
    assert.throws(() => submitChoice(room, "p1", 2, 2_100), /locked/)
    assert.equal(room.answers.p1?.choiceIndex, 0)
    assert.equal(room.answers.p2?.choiceIndex, 3)
    assert.equal(room.answers.p2?.locked, false)
  })

  it("ignores an answer after the timer", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    assert.throws(() => submitChoice(room, "p1", 0, duration), /Time is up/)
  })

  it("reveals when the timer expires and scores an unlocked pick slowly", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 100)
    room = applyTick(room, duration)
    assert.equal(room.phase, "reveal")
    assert.equal(room.reveal?.correctIndex, 0)
    assert.equal(room.players[0]?.score, BASE_POINTS)
  })

  it("reveals early when every connected player has locked", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 10)
    room = lockAnswer(room, "p1", 0)
    room = applyTick(room, 0)
    assert.equal(room.phase, "reveal")
    assert.equal(room.players[0]?.score, BASE_POINTS + MAX_SPEED_BONUS)
  })

  it("scores a wrong answer as zero", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 1), 0)
    room = submitChoice(room, "p1", 0, 10)
    room = lockAnswer(room, "p1", 10)
    room = applyTick(room, 10)
    assert.equal(room.players[0]?.score, 0)
    assert.equal(room.reveal?.results[0]?.correct, false)
  })

  it("hides the correct answer until reveal", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 2), 0)
    const during = snapshotFor(room, { role: "player", playerId: "p1" }, 0, [])
    assert.equal(during.reveal, null)
    assert.equal(during.question?.prompt, "Prompt a")
    assert.equal(during.question?.difficulty, 1)
    assert.equal("correctIndex" in (during.question ?? {}), false)
    room = submitChoice(room, "p1", 2, 10)
    room = lockAnswer(room, "p1", 10)
    room = applyTick(room, 10)
    const after = snapshotFor(room, { role: "player", playerId: "p1" }, 10, [])
    assert.equal(after.reveal?.correctIndex, 2)
    assert.equal(after.you.role === "player" ? after.you.choiceIndex : null, 2)
  })
})

describe("host settings", () => {
  it("advances automatically and keeps the mixed ramp by default", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    assert.equal(room.autoAdvance, true)
    assert.equal(room.difficulty, "mixed")
    assert.equal(room.revealDurationMs, NEXT_TIME_DEFAULT_MS)
    assert.equal(difficultyBounds(room.difficulty), null)
    room = startGame(room, question("a", 0), 0)
    room = applyTick(room, duration)
    assert.equal(room.advanceAt, duration + NEXT_TIME_DEFAULT_MS)
    const snap = snapshotFor(room, { role: "host" }, duration, [])
    assert.equal(snap.settings.autoAdvance, true)
    assert.equal(snap.revealRemainingMs, NEXT_TIME_DEFAULT_MS)
  })

  it("rejects times outside the allowed seconds", () => {
    assert.throws(() => updateSettings(roomWith(), settings({ questionDurationMs: 4_000 }), 0), GameError)
    assert.throws(() => updateSettings(roomWith(), settings({ questionDurationMs: 121_000 }), 0), GameError)
    assert.throws(() => updateSettings(roomWith(), settings({ revealDurationMs: 1_000 }), 0), GameError)
    assert.throws(() => updateSettings(roomWith(), settings({ revealDurationMs: 31_000 }), 0), GameError)
  })

  it("stores an answer time and a difficulty band", () => {
    const room = updateSettings(roomWith(), settings({ questionDurationMs: 10_000, difficulty: "2-4" }), 0)
    assert.equal(room.questionDurationMs, 10_000)
    assert.equal(room.difficulty, "2-4")
    assert.deepEqual(difficultyBounds(room.difficulty), { minDifficulty: 2, maxDifficulty: 4 })
  })

  it("reveals when a shorter answer time is already past", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = updateSettings(room, settings({ questionDurationMs: 5_000 }), 6_000)
    room = applyTick(room, 6_000)
    assert.equal(room.phase, "reveal")
  })

  it("counts down to the next question only when automatic advance is on", () => {
    let room = addPlayer(updateSettings(roomWith(), settings({ autoAdvance: true, revealDurationMs: 8_000 }), 0), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = applyTick(room, duration)
    assert.equal(room.advanceAt, duration + 8_000)
    assert.equal(advanceDue(room, duration + 7_999), false)
    assert.equal(advanceDue(room, duration + 8_000), true)
    assert.equal(alarmAt(room), duration + 8_000)
    const snap = snapshotFor(room, { role: "host" }, duration + 1_000, [])
    assert.equal(snap.revealRemainingMs, 7_000)

    let manual = addPlayer(updateSettings(roomWith(), settings({ autoAdvance: false }), 0), "p1", "Ada")
    manual = startGame(manual, question("a", 0), 0)
    manual = applyTick(manual, duration)
    assert.equal(manual.advanceAt, null)
    assert.equal(advanceDue(manual, duration + 60_000), false)
    assert.equal(alarmAt(manual), null)
    assert.equal(snapshotFor(manual, { role: "host" }, duration, []).revealRemainingMs, null)
  })

  it("restarts the wait when the delay changes and clears it when automatic next is turned off", () => {
    let room = addPlayer(updateSettings(roomWith(), settings({ autoAdvance: true, revealDurationMs: 8_000 }), 0), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = applyTick(room, duration)
    const started = room.advanceAt
    room = updateSettings(room, settings({ autoAdvance: true, difficulty: "1-2" }), duration + 500)
    assert.equal(room.advanceAt, started)
    assert.equal(room.difficulty, "1-2")
    room = updateSettings(room, settings({ autoAdvance: true, revealDurationMs: 4_000, difficulty: "1-2" }), duration + 1_000)
    assert.equal(room.advanceAt, duration + 1_000 + 4_000)
    room = updateSettings(room, settings({ autoAdvance: false, revealDurationMs: 4_000, difficulty: "1-2" }), duration + 1_500)
    assert.equal(room.advanceAt, null)
    assert.equal(room.revealDurationMs, 4_000)
  })

  it("keeps settings across a reset and fills defaults for an older room", () => {
    let room = updateSettings(
      roomWith(),
      settings({ questionDurationMs: 12_000, autoAdvance: true, revealDurationMs: 5_000, difficulty: "4-5" }),
      0,
    )
    room = addPlayer(room, "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = resetRound(room)
    assert.equal(room.phase, "lobby")
    assert.equal(room.questionDurationMs, 12_000)
    assert.equal(room.autoAdvance, true)
    assert.equal(room.revealDurationMs, 5_000)
    assert.equal(room.difficulty, "4-5")
    assert.equal(room.advanceAt, null)
    assert.deepEqual(difficultyBounds("4-5"), { minDifficulty: 4, maxDifficulty: 5 })

    const restored = restoreRoom({ code: "QUIZ", hostToken: "host" })
    assert.equal(restored.autoAdvance, true)
    assert.equal(restoreRoom({ code: "QUIZ", hostToken: "host", autoAdvance: false }).autoAdvance, false)
    assert.equal(restored.difficulty, "mixed")
    assert.equal(restored.revealDurationMs, NEXT_TIME_DEFAULT_MS)
    assert.equal(restored.advanceAt, null)
    assert.equal(restored.questionDurationMs, duration)
  })
})

describe("difficulty ramp", () => {
  it("asks for two questions at each level", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((asked) => difficultyForSlot(asked)),
      [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
    )
  })
})

describe("round flow", () => {
  it("moves to the next question and then finishes", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 0)
    room = lockAnswer(room, "p1", 0)
    room = applyTick(room, 0)
    assert.equal(room.history.length, 1)
    assert.equal(room.history[0]?.questionId, "a")
    assert.equal(room.history[0]?.correct, true)
    room = nextQuestion(room, question("b", 1), 5_000)
    assert.equal(room.phase, "question")
    assert.equal(room.questionIndex, 1)
    assert.equal(room.reveal, null)
    assert.equal(room.history.length, 1)
    room = submitChoice(room, "p1", 1, 5_100)
    room = lockAnswer(room, "p1", 5_100)
    room = applyTick(room, 5_100)
    room = nextQuestion(room, null, 9_000)
    assert.equal(room.phase, "finished")
    assert.ok((room.players[0]?.score ?? 0) > 0)
  })

  it("ends early without scoring the open question", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 10)
    room = endGame(room)
    assert.equal(room.phase, "finished")
    assert.equal(room.players[0]?.score, 0)
    assert.equal(room.history.length, 0)
    assert.equal(room.pendingPlays.length, 0)
  })

  it("queues one play when a question is revealed and keeps it after reset", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = addPlayer(room, "p3", "Cam")
    room = startGame(room, question("a", 0), 0, "round-1")
    room = submitChoice(room, "p1", 0, 10)
    room = lockAnswer(room, "p1", 10)
    room = submitChoice(room, "p3", 1, 20)
    room = applyTick(room, duration)
    assert.equal(room.pendingPlays.length, 1)
    assert.deepEqual(room.pendingPlays[0], {
      playId: "QUIZ:round-1:a",
      questionId: "a",
      correct: 1,
      incorrect: 1,
    })
    room = resetRound(room)
    assert.equal(room.phase, "lobby")
    assert.equal(room.roundId, null)
    assert.equal(room.history.length, 0)
    assert.deepEqual(room.pendingPlays, [
      {
        playId: "QUIZ:round-1:a",
        questionId: "a",
        correct: 1,
        incorrect: 1,
      },
    ])
  })

  it("starts a fresh lobby on reset", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = applyTick(room, duration)
    room = resetRound(room)
    assert.equal(room.phase, "lobby")
    assert.equal(room.players[0]?.score, 0)
    assert.equal(room.asked.length, 0)
    assert.equal(room.history.length, 0)
    assert.equal(room.reveal, null)
  })

  it("finishes when the round already has its question limit", () => {
    let room = addPlayer(createRoom({ code: "QUIZ", hostToken: "host", questionLimit: 1, questionDurationMs: duration }), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = applyTick(room, duration)
    room = nextQuestion(room, question("b", 1), duration)
    assert.equal(room.phase, "finished")
    assert.equal(room.asked.length, 1)
  })
})

describe("question policy", () => {
  it("skips questions already asked", () => {
    const picked = randomQuestionPolicy(
      [question("a", 0), question("b", 1)],
      { askedIds: ["a"], answers: [], players: [] },
      () => 0.999,
    )
    assert.equal(picked.id, "b")
  })

  it("picks the same question for the same random sequence", () => {
    const pack = [question("a", 0), question("b", 1), question("c", 2)]
    const stats = { askedIds: [], answers: [], players: [] }
    const first = randomQuestionPolicy(pack, stats, () => 0.42)
    const again = randomQuestionPolicy(pack, stats, () => 0.42)
    assert.equal(again.id, first.id)
  })

  it("keeps the current question when restoring an older room", () => {
    const legacy = {
      code: "QUIZ",
      hostToken: "host",
      players: [],
      questions: [question("a", 0), question("b", 1)],
      questionIndex: 1,
      phase: "question",
      questionStartedAt: 10,
      questionDurationMs: duration,
      answers: {},
      reveal: null,
    }
    const room = restoreRoom(legacy)
    assert.equal(room.asked.length, 2)
    assert.equal(room.asked[1]?.id, "b")
    assert.equal(room.history.length, 0)
    assert.equal(room.questionLimit, 2)
    assert.equal(room.roundId, null)
    assert.deepEqual(room.pendingPlays, [])
  })
})
