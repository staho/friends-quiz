import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { BASE_POINTS, MAX_SPEED_BONUS, REVEAL_HOLD_MS } from "../shared/types.ts"
import {
  GameError,
  applyTick,
  createRoom,
  endGame,
  isAdvanceDue,
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
  toggleAdvancePause,
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
    assert.equal("correctIndex" in (during.question ?? {}), false)
    room = submitChoice(room, "p1", 2, 10)
    room = lockAnswer(room, "p1", 10)
    room = applyTick(room, 10)
    const after = snapshotFor(room, { role: "player", playerId: "p1" }, 10, [])
    assert.equal(after.reveal?.correctIndex, 2)
    assert.equal(after.you.role === "player" ? after.you.choiceIndex : null, 2)
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

  it("moves on 10 seconds after the answer unless the host pauses", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = applyTick(room, duration)
    assert.equal(room.phase, "reveal")
    assert.equal(room.advanceAt, duration + REVEAL_HOLD_MS)
    assert.equal(room.advancePaused, false)
    assert.equal(isAdvanceDue(room, duration + REVEAL_HOLD_MS - 1), false)
    assert.equal(isAdvanceDue(room, duration + REVEAL_HOLD_MS), true)

    const playing = snapshotFor(room, { role: "host" }, duration + 2_000, [])
    assert.equal(playing.advanceRemainingMs, REVEAL_HOLD_MS - 2_000)
    assert.equal(playing.advancePaused, false)

    room = toggleAdvancePause(room, duration + 3_000)
    assert.equal(room.advancePaused, true)
    assert.equal(room.advanceAt, null)
    assert.equal(room.advanceRemainingMs, REVEAL_HOLD_MS - 3_000)
    assert.equal(isAdvanceDue(room, duration + REVEAL_HOLD_MS), false)
    const held = snapshotFor(room, { role: "host" }, duration + 9_000, [])
    assert.equal(held.advanceRemainingMs, REVEAL_HOLD_MS - 3_000)
    assert.equal(held.advancePaused, true)

    room = toggleAdvancePause(room, duration + 9_000)
    assert.equal(room.advancePaused, false)
    assert.equal(room.advanceAt, duration + 9_000 + (REVEAL_HOLD_MS - 3_000))
    assert.equal(room.advanceRemainingMs, null)

    room = nextQuestion(room, question("b", 1), room.advanceAt ?? 0)
    assert.equal(room.phase, "question")
    assert.equal(room.advanceAt, null)
    assert.equal(room.advancePaused, false)
    assert.equal(room.advanceRemainingMs, null)
  })

  it("leaves an older reveal in place until the host moves on", () => {
    const room = restoreRoom({
      code: "QUIZ",
      hostToken: "host",
      phase: "reveal",
      questionIndex: 0,
      asked: [question("a", 0)],
      reveal: {
        correctIndex: 0,
        prompt: "Prompt a",
        choices: ["Red", "Blue", "Gold", "Green"],
        results: [],
      },
    })
    assert.equal(room.advanceAt, null)
    assert.equal(room.advancePaused, false)
    assert.equal(isAdvanceDue(room, 60_000), false)
    assert.equal(snapshotFor(room, { role: "host" }, 60_000, []).advanceRemainingMs, null)
  })

  it("refuses to pause before the answer is showing", () => {
    const room = addPlayer(roomWith(), "p1", "Ada")
    assert.throws(() => toggleAdvancePause(startGame(room, question("a", 0), 0), 1), GameError)
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
