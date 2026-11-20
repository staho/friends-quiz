import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  BASE_POINTS,
  DEAL_RETRY_MS,
  MAX_SPEED_BONUS,
  NEXT_TIME_DEFAULT_MS,
  READY_DURATION_MS,
  ROOM_TTL_MS,
  type RoomSettings,
} from "../shared/types.ts"
import {
  GameError,
  advanceDue,
  alarmAt,
  clearStall,
  competitionRanks,
  expiresAt,
  leavePlayer,
  normalizeName,
  reconnectPlayer,
  removePlayer,
  setPlayerConnected,
  stallAdvance,
  toggleAdvancePause,
  applyTick,
  createRoom,
  difficultyBounds,
  difficultyForSlot,
  endGame,
  joinPlayer,
  lockAnswer,
  withLiveConnections,
  dealExcludeIds,
  nextQuestion,
  randomQuestionPolicy,
  resetRound,
  restoreRoom,
  scoreAnswer,
  snapshotFor,
  startGame,
  submitChoice,
  takeFromDeck,
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
    categoryLabel: "General",
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

function playing(room: Room, item: Question, now: number, roundId?: string): Room {
  const ready =
    roundId === undefined
      ? startGame(room, item, now - READY_DURATION_MS)
      : startGame(room, item, now - READY_DURATION_MS, roundId)
  return applyTick(ready, now)
}

function openedNext(room: Room, item: Question, now: number): Room {
  return applyTick(nextQuestion(room, item, now - READY_DURATION_MS), now)
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
    assert.throws(() => addPlayer(room, "p2", "ada"), /name_taken/)
  })

  it("lets a disconnected player reclaim the same name", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = { ...room, players: room.players.map((player) => ({ ...player, connected: false })) }
    const rejoined = joinPlayer(room, { id: "p2", name: "Ada", token: "new" })
    assert.equal(rejoined.player.id, "p1")
    assert.equal(rejoined.player.token, "new")
    assert.equal(rejoined.player.connected, true)
  })

  it("lets a player reclaim a name when no live socket holds it", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    const present = withLiveConnections(room, new Set(["p2"]))
    assert.equal(present.players.find((player) => player.id === "p1")?.connected, false)
    assert.equal(present.players.find((player) => player.id === "p2")?.connected, true)
    const rejoined = joinPlayer(present, { id: "p3", name: "Ada", token: "new" })
    assert.equal(rejoined.player.id, "p1")
    assert.equal(rejoined.player.token, "new")
    assert.equal(rejoined.player.connected, true)
  })

  it("keeps a name taken while that player still has a live socket", () => {
    const room = addPlayer(roomWith(), "p1", "Ada")
    const present = withLiveConnections(room, new Set(["p1"]))
    assert.equal(present, room)
    assert.throws(() => joinPlayer(present, { id: "p2", name: "ada", token: "new" }), /name_taken/)
  })

  it("lets a player join after the round starts and starts them on 0 points", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = applyTick(submitChoice(room, "p1", 0, 100), duration)
    assert.equal(room.phase, "reveal")
    room = addPlayer(room, "p2", "Bea")
    assert.equal(room.players.find((p) => p.id === "p2")?.score, 0)
    assert.equal(room.reveal?.results.some((r) => r.playerId === "p2"), false)
    room = endGame(room)
    room = addPlayer(room, "p3", "Cy")
    assert.equal(room.players.find((p) => p.id === "p3")?.score, 0)
  })

  it("lets a player join mid-question and blocks the early reveal until they lock", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 100)
    room = lockAnswer(room, "p1", 200)
    room = addPlayer(room, "p2", "Bea")
    assert.equal(room.players.find((p) => p.id === "p2")?.score, 0)
    assert.equal(applyTick(room, 300).phase, "question")
    room = submitChoice(room, "p2", 1, 400)
    room = lockAnswer(room, "p2", 500)
    const done = applyTick(room, 500)
    assert.equal(done.phase, "reveal")
    assert.equal(done.reveal?.results.find((r) => r.playerId === "p2")?.points, 0)
  })

  it("refuses the twenty-first player but still accepts a rejoin", () => {
    let room = roomWith()
    for (let i = 0; i < 20; i++) room = addPlayer(room, `p${i}`, `Player ${i}`)
    assert.throws(() => addPlayer(room, "x", "Extra"), /room_full/)
    room = setPlayerConnected(room, "p3", false)
    const back = joinPlayer(room, { id: "x", name: "player 3", token: "new" })
    assert.equal(back.player.id, "p3")
  })

  it("strips invisible characters from names", () => {
    assert.equal(normalizeName("A\u200bd\u202ea\ufeff"), "Ada")
    assert.equal(normalizeName("  Ada   Lovelace "), "Ada Lovelace")
    assert.throws(() => normalizeName("\u200b\u200b\ufeff"), /name_empty/)
    assert.throws(() => normalizeName("x".repeat(17)), /name_too_long/)
    assert.equal(normalizeName("😀".repeat(16)), "😀".repeat(16))
    assert.throws(() => normalizeName("😀".repeat(17)), /name_too_long/)
  })

  it("treats Polish capitals as the same name", () => {
    const room = addPlayer(roomWith(), "p1", "Łukasz")
    assert.throws(() => addPlayer(room, "p2", "ŁUKASZ"), /name_taken/)
  })
})

describe("leaving and removal", () => {
  it("removes a leaving player in the lobby", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = leavePlayer(room, "p1")
    assert.equal(room.players.length, 0)
    assert.equal(removePlayer(room, "nobody"), room)
  })

  it("frees the seat at once when a player leaves after the round", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = playing(room, question("a", 0), 0)
    room = applyTick(lockAnswer(submitChoice(room, "p1", 0, 0), "p1", 0), duration)
    room = endGame(room)
    room = leavePlayer(room, "p1")
    assert.deepEqual(room.players.map((p) => p.id), ["p2"])
    assert.equal(resetRound(room).players.length, 1)
    assert.throws(() => reconnectPlayer(room, "p1", "token-p1"), /rejoin/)
  })

  it("keeps a player who left mid-round in the standings, marked gone, and stops waiting for them", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = playing(room, question("a", 0), 0)
    room = lockAnswer(submitChoice(room, "p1", 0, 100), "p1", 200)
    room = submitChoice(room, "p2", 1, 300)
    room = leavePlayer(room, "p2")
    assert.equal(room.answers.p2, undefined)
    assert.equal(room.players.find((p) => p.id === "p2")?.left, true)
    assert.throws(() => reconnectPlayer(room, "p2", "token-p2"), /rejoin/)
    // Ada is the only player still to lock, so the question reveals at once.
    const shown = applyTick(room, 400)
    assert.equal(shown.phase, "reveal")
    assert.deepEqual(shown.reveal?.results.map((r) => r.playerId), ["p1"])
    const snap = snapshotFor(shown, { role: "host" }, 400, [])
    const gone = snap.players.find((p) => p.id === "p2")
    assert.equal(gone?.left, true)
    assert.equal(gone?.rank, 0)
    assert.equal(snap.players.find((p) => p.id === "p1")?.rank, 1)
  })

  it("keeps a leaver's earned points visible but never lists them again in later reveals", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = playing(room, question("a", 0), 0)
    room = lockAnswer(submitChoice(room, "p1", 0, 0), "p1", 0)
    room = applyTick(lockAnswer(submitChoice(room, "p2", 0, 0), "p2", 0), 0)
    assert.equal(room.phase, "reveal")
    room = leavePlayer(room, "p2")
    const earned = room.players.find((p) => p.id === "p2")?.score ?? 0
    assert.ok(earned > 0)
    room = openedNext(room, question("b", 1), 10_000)
    assert.equal(room.players.find((p) => p.id === "p2")?.score, earned)
    room = applyTick(lockAnswer(submitChoice(room, "p1", 1, 10_100), "p1", 10_100), 10_200)
    assert.equal(room.phase, "reveal")
    assert.deepEqual(room.reveal?.results.map((r) => r.playerId), ["p1"])
    assert.equal(room.reveal?.counts.reduce((a, b) => a + b, 0), 1)
    assert.equal(room.history.filter((h) => h.playerId === "p2").length, 1)
  })

  it("drops players who left when the round ends or a new one starts", () => {
    const base = () => {
      let room = addPlayer(roomWith(), "p1", "Ada")
      room = addPlayer(room, "p2", "Bea")
      room = playing(room, question("a", 0), 0)
      return leavePlayer(room, "p2")
    }
    assert.deepEqual(endGame(base()).players.map((p) => p.id), ["p1"])
    const lastQuestion = applyTick(base(), duration)
    assert.deepEqual(nextQuestion(lastQuestion, null, duration).players.map((p) => p.id), ["p1"])
    assert.deepEqual(resetRound({ ...base() }).players.map((p) => p.id), ["p1"])
  })

  it("lets a new player take the name of one who left, as a fresh player", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = leavePlayer(room, "p1")
    const back = joinPlayer(room, { id: "n", name: "ada", token: "fresh" })
    assert.equal(back.player.id, "n")
    assert.equal(back.player.score, 0)
    assert.deepEqual(back.room.players.map((p) => p.id), ["n"])
  })

  it("frees a full room's seats held by players who left", () => {
    let room = roomWith()
    for (let i = 0; i < 20; i++) room = addPlayer(room, `p${i}`, `Gracz ${i}`)
    room = playing(room, question("a", 0), 0)
    assert.throws(() => addPlayer(room, "x", "Nowy"), /room_full/)
    room = leavePlayer(room, "p3")
    assert.equal(addPlayer(room, "x", "Nowy").players.length, 20)
  })

  it("does not wait for a player who is only disconnected, and keeps their seat", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = playing(room, question("a", 0), 0)
    room = setPlayerConnected(room, "p2", false)
    assert.equal(room.players.find((p) => p.id === "p2")?.left, false)
    assert.equal(snapshotFor(room, { role: "host" }, 0, []).players.find((p) => p.id === "p2")?.rank, 1)
    assert.equal(reconnectPlayer(room, "p2", "token-p2").players.find((p) => p.id === "p2")?.connected, true)
  })

  it("reveals early after removing the only unlocked player", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = playing(room, question("a", 0), 0)
    room = lockAnswer(submitChoice(room, "p1", 0, 100), "p1", 200)
    room = submitChoice(room, "p2", 1, 300)
    assert.equal(applyTick(room, 400).phase, "question")
    room = removePlayer(room, "p2")
    assert.equal(room.answers.p2, undefined)
    const after = applyTick(room, 400)
    assert.equal(after.phase, "reveal")
    assert.equal(after.reveal?.results.length, 1)
  })

  it("sends a removed player's socket a guest view", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = removePlayer(room, "p1")
    const snap = snapshotFor(room, { role: "player", playerId: "p1" }, 0, [])
    assert.equal(snap.you.role, "guest")
  })

  it("drops the reveal from the snapshot when the game ends mid-question", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = endGame(room)
    assert.equal(room.reveal, null)
    assert.equal(snapshotFor(room, { role: "host" }, 10, []).reveal, null)
    let done = playing(addPlayer(roomWith(), "p1", "Ada"), question("a", 0), 0)
    done = endGame(applyTick(done, duration))
    assert.equal(snapshotFor(done, { role: "host" }, duration, []).reveal, null)
  })
})

describe("frozen duration and unlocked scoring", () => {
  it("keeps the open question's time when the answer time changes; applies it from the next question", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = updateSettings(room, settings({ questionDurationMs: 5_000 }), 6_000)
    assert.equal(room.activeDurationMs, duration)
    assert.equal(applyTick(room, 6_000).phase, "question")
    assert.equal(alarmAt(room), duration)
    assert.equal(snapshotFor(room, { role: "host" }, 6_000, []).question?.durationMs, duration)
    assert.equal(snapshotFor(room, { role: "host" }, 6_000, []).question?.remainingMs, duration - 6_000)
    assert.equal(applyTick(room, duration).phase, "reveal")
    const next = openedNext(applyTick(room, duration), question("b", 1), 30_000)
    assert.equal(next.activeDurationMs, 5_000)
    assert.equal(alarmAt(next), 35_000)
  })

  it("scores an unlocked correct pick the same on early reveal and on timeout", () => {
    const build = () => {
      let room = addPlayer(roomWith(), "p1", "Ada")
      room = addPlayer(room, "p2", "Bea")
      room = playing(room, question("a", 0), 0)
      room = submitChoice(room, "p1", 0, 100)
      room = lockAnswer(submitChoice(room, "p2", 1, 100), "p2", 200)
      return room
    }
    const early = applyTick(setPlayerConnected(build(), "p1", false), 5_000)
    const timeout = applyTick(build(), duration)
    for (const room of [early, timeout]) {
      assert.equal(room.phase, "reveal")
      const ada = room.reveal?.results.find((r) => r.playerId === "p1")
      assert.equal(ada?.points, BASE_POINTS)
      assert.equal(ada?.elapsedMs, duration)
    }
  })
})

describe("ranks and counts", () => {
  it("ranks with ties and reports previousRank after a reveal", () => {
    let room = roomWith()
    for (const [id, name, score] of [["a", "Ada", 100], ["b", "Bea", 100], ["c", "Cy", 50]] as const) {
      room = { ...addPlayer(room, id, name), phase: "lobby" }
      room = { ...room, players: room.players.map((p) => (p.id === id ? { ...p, score } : p)) }
    }
    const ranks = snapshotFor(room, { role: "host" }, 0, []).players.map((p) => [p.rank, p.previousRank])
    assert.deepEqual(ranks, [[1, null], [1, null], [3, null]])
    assert.deepEqual(
      [...competitionRanks(new Map([["a", 100], ["b", 100], ["c", 50]])).values()],
      [1, 1, 3],
    )

    let game = playing(room, question("q", 0), 0)
    game = lockAnswer(submitChoice(game, "c", 0, 0), "c", 0)
    game = applyTick(lockAnswer(submitChoice(game, "a", 1, 0), "a", 0), duration)
    game = { ...game }
    const snap = snapshotFor(game, { role: "host" }, duration, [])
    const byId = Object.fromEntries(snap.players.map((p) => [p.id, p]))
    assert.equal(byId.c?.score, 50 + 1000)
    assert.equal(byId.c?.rank, 1)
    assert.equal(byId.a?.rank, 2)
    // The first question of a round has no earlier standings, so nothing moved.
    assert.ok(snap.players.every((p) => p.previousRank === null))
    // On the second question the places before it are the standings after the first.
    const second = applyTick(
      lockAnswer(submitChoice(openedNext(game, question("q2", 0), 30_000), "b", 0, 30_000), "b", 30_000),
      30_000 + duration,
    )
    const byId2 = Object.fromEntries(snapshotFor(second, { role: "host" }, 30_000 + duration, []).players.map((p) => [p.id, p]))
    assert.equal(byId2.c?.previousRank, 1)
    assert.equal(byId2.c?.rank, 2)
    assert.equal(byId2.b?.previousRank, 2)
    assert.equal(byId2.b?.rank, 1)
    assert.equal(byId2.a?.previousRank, 2)
    assert.equal(byId2.a?.rank, 3)
    const late = addPlayer(second, "d", "Dee")
    assert.equal(snapshotFor(late, { role: "host" }, 30_000 + duration, []).players.find((p) => p.id === "d")?.previousRank, null)
    const finished = endGame(second)
    assert.ok(snapshotFor(finished, { role: "host" }, duration, []).players.every((p) => p.previousRank === null))
  })

  it("counts every pick per choice, locked or not", () => {
    let room = roomWith()
    for (const id of ["a", "b", "c", "d"]) room = addPlayer(room, id, id)
    room = playing(room, question("q", 0), 0)
    room = lockAnswer(submitChoice(room, "a", 0, 10), "a", 20)
    room = submitChoice(room, "b", 0, 10)
    room = submitChoice(room, "c", 3, 10)
    room = applyTick(room, duration)
    assert.deepEqual(room.reveal?.counts, [2, 0, 0, 1])
  })
})

describe("category and stall", () => {
  it("shows the category label in the ready and question views", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, { ...question("a", 0), categoryLabel: "Geografia" }, 0)
    assert.equal(snapshotFor(room, { role: "host" }, 0, []).ready?.category, "Geografia")
    room = applyTick(room, READY_DURATION_MS)
    assert.equal(snapshotFor(room, { role: "host" }, READY_DURATION_MS, []).question?.category, "Geografia")
  })

  it("moves advanceAt when a deal stalls and reports it to the host only", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = applyTick(playing(room, question("a", 0), 0), duration)
    const stalled = stallAdvance(room, 50_000)
    assert.equal(stalled.stalled, true)
    assert.equal(stalled.advanceAt, 50_000 + DEAL_RETRY_MS)
    assert.equal(snapshotFor(stalled, { role: "host" }, 50_000, []).stalled, true)
    assert.equal(snapshotFor(stalled, { role: "player", playerId: "p1" }, 50_000, []).stalled, false)
    assert.equal(clearStall(stalled).stalled, false)
    const manual = stallAdvance({ ...room, autoAdvance: false }, 50_000)
    assert.equal(manual.stalled, true)
    assert.equal(manual.advanceAt, room.advanceAt)
  })

  it("expires two days after the last activity, never when unknown", () => {
    const room = roomWith()
    assert.equal(expiresAt(room), null)
    assert.equal(expiresAt({ ...room, lastActivityAt: 1_000 }), 1_000 + ROOM_TTL_MS)
  })
})

describe("restoring a stored room", () => {
  it("fills the new fields for a row stored before they existed", () => {
    const oldQuestion = {
      id: "a",
      prompt: "Prompt a",
      choices: ["Red", "Blue", "Gold", "Green"],
      correctIndex: 0,
      category: "general",
      difficulty: 1,
    }
    const stored = {
      code: "QUIZ",
      hostToken: "host",
      players: [{ id: "p1", name: "Ada", score: 800, connected: true, token: "t" }],
      asked: [oldQuestion],
      questionIndex: 0,
      phase: "reveal",
      questionDurationMs: 30_000,
      revealDurationMs: 8_000,
      answers: {},
      reveal: {
        correctIndex: 0,
        prompt: "Prompt a",
        choices: oldQuestion.choices,
        results: [
          { playerId: "p1", name: "Ada", choiceIndex: 0, correct: true, points: 800, score: 800, elapsedMs: 1, locked: true },
          { playerId: "p2", name: "Bea", choiceIndex: 3, correct: false, points: 0, score: 0, elapsedMs: 1, locked: false },
          { playerId: "p3", name: "Cy", choiceIndex: null, correct: false, points: 0, score: 0, elapsedMs: 1, locked: false },
        ],
      },
    }
    const room = restoreRoom(stored)
    assert.equal(room.activeDurationMs, 30_000)
    assert.equal(room.lastActivityAt, 0)
    assert.equal(room.stalled, false)
    assert.equal(expiresAt(room), null)
    assert.equal(room.asked[0]?.categoryLabel, "")
    assert.deepEqual(room.reveal?.counts, [1, 0, 0, 1])
    const snap = snapshotFor(room, { role: "host" }, 0, [])
    assert.equal(snap.reveal?.counts[3], 1)
    assert.equal(snap.players[0]?.rank, 1)
    assert.equal(snap.players[0]?.previousRank, null)
    assert.equal(snap.players[0]?.left, false)
    assert.equal(room.players[0]?.left, false)
    assert.equal(restoreRoom({ ...stored, activeDurationMs: 1 }).activeDurationMs, 30_000)
    assert.equal(restoreRoom({ ...stored, activeDurationMs: 7_000 }).activeDurationMs, 7_000)
    assert.equal(restoreRoom({ ...stored, stalled: true, lastActivityAt: 5 }).stalled, true)
    assert.equal(restoreRoom({ ...stored, lastActivityAt: "x" }).lastActivityAt, 0)
    const counted = restoreRoom({ ...stored, reveal: { ...stored.reveal, counts: [9, 8, 7, 6] } })
    assert.deepEqual(counted.reveal?.counts, [9, 8, 7, 6])
    const label = restoreRoom({ ...stored, asked: [{ ...oldQuestion, categoryLabel: "Geografia" }] })
    assert.equal(label.asked[0]?.categoryLabel, "Geografia")
  })

  it("keeps a stored token-less player and refuses their old token", () => {
    const room = restoreRoom({
      code: "QUIZ",
      hostToken: "host",
      players: [{ id: "p1", name: "Ada", score: 5, connected: false, token: "" }],
      phase: "finished",
    })
    assert.throws(() => reconnectPlayer(room, "p1", ""), /rejoin/)
  })
})

describe("answers", () => {
  it("keeps one answer per player and lets them change it until lock", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = playing(room, question("a", 0), 1_000)
    room = submitChoice(room, "p1", 1, 1_200)
    room = submitChoice(room, "p1", 0, 1_400)
    room = submitChoice(room, "p2", 3, 1_500)
    room = lockAnswer(room, "p1", 2_000)
    assert.throws(() => submitChoice(room, "p1", 2, 2_100), /answer_locked/)
    assert.equal(room.answers.p1?.choiceIndex, 0)
    assert.equal(room.answers.p2?.choiceIndex, 3)
    assert.equal(room.answers.p2?.locked, false)
  })

  it("ignores an answer after the timer", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    assert.throws(() => submitChoice(room, "p1", 0, duration), /time_up/)
  })

  it("reveals when the timer expires and scores an unlocked pick slowly", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 100)
    room = applyTick(room, duration)
    assert.equal(room.phase, "reveal")
    assert.equal(room.reveal?.correctIndex, 0)
    assert.equal(room.players[0]?.score, BASE_POINTS)
  })

  it("reveals early when every connected player has locked", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 10)
    room = lockAnswer(room, "p1", 0)
    room = applyTick(room, 0)
    assert.equal(room.phase, "reveal")
    assert.equal(room.players[0]?.score, BASE_POINTS + MAX_SPEED_BONUS)
    assert.equal(room.reveal?.results[0]?.locked, true)
    assert.equal(room.reveal?.results[0]?.elapsedMs, 0)
  })

  it("keeps the question open while someone connected has not locked", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = addPlayer(room, "p2", "Bea")
    room = playing(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 100)
    room = lockAnswer(room, "p1", 500)
    room = applyTick(room, 500)
    assert.equal(room.phase, "question")
    room = submitChoice(room, "p2", 0, 19_000)
    room = applyTick(room, duration)
    assert.equal(room.phase, "reveal")
    const ada = room.reveal?.results.find((result) => result.playerId === "p1")
    const bea = room.reveal?.results.find((result) => result.playerId === "p2")
    assert.equal(ada?.locked, true)
    assert.equal(ada?.elapsedMs, 500)
    assert.equal(bea?.locked, false)
    assert.equal(bea?.elapsedMs, duration)
  })

  it("scores a wrong answer as zero", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 1), 0)
    room = submitChoice(room, "p1", 0, 10)
    room = lockAnswer(room, "p1", 10)
    room = applyTick(room, 10)
    assert.equal(room.players[0]?.score, 0)
    assert.equal(room.reveal?.results[0]?.correct, false)
  })

  it("hides the correct answer until reveal", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 2), 0)
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
    room = playing(room, question("a", 0), 0)
    room = applyTick(room, duration)
    assert.equal(room.advanceAt, duration + NEXT_TIME_DEFAULT_MS)
    const snap = snapshotFor(room, { role: "host" }, duration, [])
    assert.equal(snap.settings.autoAdvance, true)
    assert.equal(snap.revealRemainingMs, NEXT_TIME_DEFAULT_MS + READY_DURATION_MS)
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

  it("counts down to the next question only when automatic advance is on", () => {
    let room = addPlayer(updateSettings(roomWith(), settings({ autoAdvance: true, revealDurationMs: 8_000 }), 0), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = applyTick(room, duration)
    assert.equal(room.advanceAt, duration + 8_000)
    assert.equal(advanceDue(room, duration + 7_999), false)
    assert.equal(advanceDue(room, duration + 8_000), true)
    assert.equal(alarmAt(room), duration + 8_000)
    const snap = snapshotFor(room, { role: "host" }, duration + 1_000, [])
    assert.equal(snap.revealRemainingMs, 7_000 + READY_DURATION_MS)

    let manual = addPlayer(updateSettings(roomWith(), settings({ autoAdvance: false }), 0), "p1", "Ada")
    manual = playing(manual, question("a", 0), 0)
    manual = applyTick(manual, duration)
    assert.equal(manual.advanceAt, null)
    assert.equal(advanceDue(manual, duration + 60_000), false)
    assert.equal(alarmAt(manual), null)
    assert.equal(snapshotFor(manual, { role: "host" }, duration, []).revealRemainingMs, null)
  })

  it("counts the get-ready countdown in the wait after the answer", () => {
    let room = addPlayer(updateSettings(roomWith(), settings({ autoAdvance: true, revealDurationMs: 5_000 }), 0), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = applyTick(room, duration)
    assert.equal(snapshotFor(room, { role: "host" }, duration, []).revealRemainingMs, 5_000 + READY_DURATION_MS)
    assert.equal(advanceDue(room, duration + 5_000 - 1), false)
    room = applyTick(nextQuestion(room, question("b", 1), duration + 5_000), duration + 5_000)
    assert.equal(room.phase, "ready")
    room = applyTick(room, duration + 5_000 + READY_DURATION_MS)
    assert.equal(room.phase, "question")
    assert.equal(room.questionStartedAt, duration + 8_000)
  })

  it("restarts the wait when the delay changes and clears it when automatic next is turned off", () => {
    let room = addPlayer(updateSettings(roomWith(), settings({ autoAdvance: true, revealDurationMs: 8_000 }), 0), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
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

  it("holds the countdown while the host pauses and resumes the remaining wait", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = applyTick(room, duration)
    assert.equal(room.advanceAt, duration + NEXT_TIME_DEFAULT_MS)
    assert.equal(room.advancePaused, false)

    room = toggleAdvancePause(room, duration + 3_000)
    assert.equal(room.advancePaused, true)
    assert.equal(room.advanceAt, null)
    assert.equal(room.advanceRemainingMs, NEXT_TIME_DEFAULT_MS - 3_000)
    assert.equal(advanceDue(room, duration + NEXT_TIME_DEFAULT_MS), false)
    assert.equal(alarmAt(room), null)
    const held = snapshotFor(room, { role: "host" }, duration + 9_000, [])
    assert.equal(held.advancePaused, true)
    assert.equal(held.revealRemainingMs, NEXT_TIME_DEFAULT_MS - 3_000 + READY_DURATION_MS)

    room = toggleAdvancePause(room, duration + 9_000)
    assert.equal(room.advancePaused, false)
    assert.equal(room.advanceAt, duration + 9_000 + (NEXT_TIME_DEFAULT_MS - 3_000))
    assert.equal(room.advanceRemainingMs, null)
    assert.equal(advanceDue(room, room.advanceAt - 1), false)
    assert.equal(advanceDue(room, room.advanceAt), true)
  })

  it("refuses to pause before the answer is showing or when automatic next is off", () => {
    const room = addPlayer(roomWith(), "p1", "Ada")
    assert.throws(() => toggleAdvancePause(playing(room, question("a", 0), 0), 1), GameError)
    let manual = addPlayer(updateSettings(roomWith(), settings({ autoAdvance: false }), 0), "p1", "Ada")
    manual = playing(manual, question("a", 0), 0)
    manual = applyTick(manual, duration)
    assert.throws(() => toggleAdvancePause(manual, duration), GameError)
  })

  it("keeps settings across a reset and fills defaults for an older room", () => {
    let room = updateSettings(
      roomWith(),
      settings({ questionDurationMs: 12_000, autoAdvance: true, revealDurationMs: 5_000, difficulty: "4-5" }),
      0,
    )
    room = addPlayer(room, "p1", "Ada")
    room = playing(room, question("a", 0), 0)
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
    assert.equal(restored.readyUntil, null)
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
    room = playing(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 0)
    room = lockAnswer(room, "p1", 0)
    room = applyTick(room, 0)
    assert.equal(room.history.length, 1)
    assert.equal(room.history[0]?.questionId, "a")
    assert.equal(room.history[0]?.correct, true)
    room = openedNext(room, question("b", 1), 5_000)
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
    room = playing(room, question("a", 0), 0)
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
    room = playing(room, question("a", 0), 0, "round-1")
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
    room = playing(room, question("a", 0), 0)
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
    room = playing(room, question("a", 0), 0)
    room = applyTick(room, duration)
    room = nextQuestion(room, question("b", 1), duration)
    assert.equal(room.phase, "finished")
    assert.equal(room.asked.length, 1)
  })
})

describe("get ready", () => {
  it("hides the question, blocks answers, and opens on a full clock", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 2), 1_000)
    assert.equal(room.phase, "ready")
    assert.equal(room.questionStartedAt, null)
    assert.equal(room.readyUntil, 1_000 + READY_DURATION_MS)
    assert.equal(alarmAt(room), 1_000 + READY_DURATION_MS)
    assert.throws(() => submitChoice(room, "p1", 0, 1_100), /no_question_open/)
    assert.throws(() => lockAnswer(room, "p1", 1_100), /no_question_open/)

    const during = snapshotFor(room, { role: "player", playerId: "p1" }, 1_500, [])
    assert.equal(during.phase, "ready")
    assert.equal(during.question, null)
    assert.equal(during.reveal, null)
    assert.equal(during.ready?.index, 0)
    assert.equal(during.ready?.total, 10)
    assert.equal(during.ready?.durationMs, READY_DURATION_MS)
    assert.equal(during.ready?.remainingMs, READY_DURATION_MS - 500)

    assert.equal(applyTick(room, 1_000 + READY_DURATION_MS - 1).phase, "ready")
    room = applyTick(room, 1_000 + READY_DURATION_MS)
    assert.equal(room.phase, "question")
    assert.equal(room.questionStartedAt, 1_000 + READY_DURATION_MS)
    assert.equal(room.readyUntil, null)
    const open = snapshotFor(room, { role: "host" }, 1_000 + READY_DURATION_MS, [])
    assert.equal(open.ready, null)
    assert.equal(open.question?.prompt, "Prompt a")
    assert.equal(open.question?.remainingMs, duration)
    assert.equal("correctIndex" in (open.question ?? {}), false)
  })

  it("counts down again before the next question", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, question("a", 0), 0)
    room = submitChoice(room, "p1", 0, 0)
    room = lockAnswer(room, "p1", 0)
    room = applyTick(room, 0)
    room = nextQuestion(room, question("b", 1), 5_000)
    assert.equal(room.phase, "ready")
    assert.equal(room.questionIndex, 1)
    assert.equal(room.reveal, null)
    assert.equal(room.history.length, 1)
    assert.equal(room.readyUntil, 5_000 + READY_DURATION_MS)
    const snap = snapshotFor(room, { role: "host" }, 5_000, [])
    assert.equal(snap.question, null)
    assert.equal(snap.ready?.index, 1)
    assert.equal(snap.ready?.remainingMs, READY_DURATION_MS)
    room = applyTick(room, 5_000 + READY_DURATION_MS)
    assert.equal(room.phase, "question")
    assert.equal(room.questionStartedAt, 5_000 + READY_DURATION_MS)
    assert.equal(snapshotFor(room, { role: "host" }, 5_000 + READY_DURATION_MS, []).question?.prompt, "Prompt b")
  })

  it("ends during get ready without scoring", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = startGame(room, question("a", 0), 0)
    room = endGame(room)
    assert.equal(room.phase, "finished")
    assert.equal(room.readyUntil, null)
    assert.equal(room.players[0]?.score, 0)
    assert.equal(room.history.length, 0)
    assert.equal(room.pendingPlays.length, 0)
  })

  it("restores a get-ready room and opens it when the countdown is over", () => {
    const restored = restoreRoom({
      code: "QUIZ",
      hostToken: "host",
      players: [{ id: "p1", name: "Ada", score: 0, connected: true, token: "t" }],
      asked: [question("a", 0)],
      questionIndex: 0,
      questionLimit: 10,
      phase: "ready",
      readyUntil: 4_000,
      questionDurationMs: duration,
      answers: {},
    })
    assert.equal(restored.phase, "ready")
    assert.equal(restored.readyUntil, 4_000)
    assert.equal(applyTick(restored, 3_999).phase, "ready")
    const opened = applyTick(restored, 4_000)
    assert.equal(opened.phase, "question")
    assert.equal(opened.questionStartedAt, 4_000)
    assert.equal(opened.readyUntil, null)
  })
})

describe("question deck", () => {
  function atDifficulty(id: string, difficulty: number): Question {
    return { ...question(id, 0), difficulty }
  }

  it("keeps asked questions out of the next round", () => {
    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, atDifficulty("a", 1), 0)
    room = applyTick(room, duration)
    room = openedNext(room, atDifficulty("c", 2), duration)
    assert.deepEqual(room.seen, [
      { id: "a", difficulty: 1 },
      { id: "c", difficulty: 2 },
    ])
    room = resetRound(room)
    assert.equal(room.asked.length, 0)
    assert.deepEqual(dealExcludeIds(room), ["a", "c"])
    assert.deepEqual(restoreRoom({ code: "QUIZ", hostToken: "host" }).seen, [])
    assert.deepEqual(
      restoreRoom({
        code: "QUIZ",
        hostToken: "host",
        seen: [
          { id: "paris", difficulty: 1 },
          { id: "", difficulty: 1 },
          { id: "nope", difficulty: 9 },
          { id: "paris", difficulty: 2 },
        ],
      }).seen,
      [{ id: "paris", difficulty: 1 }],
    )
  })

  it("draws a used-up difficulty again and leaves the others out", async () => {
    const pool = [atDifficulty("a", 1), atDifficulty("b", 1), atDifficulty("c", 2)]
    const calls: Array<{ bounds?: { minDifficulty: number; maxDifficulty: number } }> = []
    const pick = async (
      excludeIds: string[],
      difficulty: number,
      bounds?: { minDifficulty: number; maxDifficulty: number },
    ): Promise<Question | null> => {
      calls.push({ bounds })
      const min = bounds?.minDifficulty ?? 1
      const max = bounds?.maxDifficulty ?? 5
      const excluded = new Set(excludeIds)
      const open = pool.filter(
        (item) => item.difficulty >= min && item.difficulty <= max && !excluded.has(item.id),
      )
      return open.find((item) => item.difficulty === difficulty) ?? open[0] ?? null
    }

    let room = addPlayer(roomWith(), "p1", "Ada")
    room = playing(room, pool[0]!, 0)
    room = { ...room, seen: [...room.seen, { id: "b", difficulty: 1 }, { id: "c", difficulty: 2 }] }
    const dealt = await takeFromDeck(room, 1, null, pick)
    assert.equal(dealt.question?.id, "b")
    assert.deepEqual(dealt.room.seen, [
      { id: "c", difficulty: 2 },
      { id: "a", difficulty: 1 },
    ])
    assert.deepEqual(calls[0]?.bounds, { minDifficulty: 1, maxDifficulty: 1 })
    assert.equal(calls[1]?.bounds, undefined)

    room = resetRound(dealt.room)
    room = {
      ...room,
      seen: [
        { id: "a", difficulty: 1 },
        { id: "b", difficulty: 1 },
        { id: "c", difficulty: 2 },
      ],
    }
    const fresh = await takeFromDeck(room, 1, null, pick)
    assert.equal(fresh.question?.difficulty, 1)
    assert.ok(fresh.question?.id === "a" || fresh.question?.id === "b")
    assert.deepEqual(fresh.room.seen, [{ id: "c", difficulty: 2 }])
    const started = startGame(fresh.room, fresh.question!, 0)
    assert.equal(
      started.seen.some((item) => item.id === fresh.question?.id && item.difficulty === 1),
      true,
    )
    assert.equal(started.seen.some((item) => item.id === "c"), true)
    const other = fresh.question?.id === "a" ? "b" : "a"
    const follow = await takeFromDeck(started, 1, null, pick)
    assert.equal(follow.question?.id, other)
    assert.deepEqual(follow.room.seen, started.seen)
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
    assert.equal(room.readyUntil, null)
    assert.deepEqual(room.pendingPlays, [])
    const stuck = restoreRoom({
      code: "QUIZ",
      hostToken: "host",
      phase: "ready",
      asked: [question("a", 0)],
      questionIndex: 0,
    })
    assert.equal(stuck.readyUntil, 0)
    assert.equal(applyTick(stuck, 0).phase, "question")
  })
})
