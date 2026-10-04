import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  displayedQuestionSecond,
  displayedReadySecond,
  hostCues,
  playerCues,
  type HostFrame,
} from "../client/src/cues.ts"
import type {
  ChoiceIndex,
  PlayerView,
  PublicPlayer,
  PublicQuestion,
  PublicReady,
  PublicReveal,
  RevealResult,
  RoomSnapshot,
} from "../shared/types.ts"

function player(id: string, overrides: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id,
    name: id,
    score: 0,
    connected: true,
    picked: false,
    locked: false,
    ...overrides,
  }
}

function question(index = 0): PublicQuestion {
  return {
    prompt: "Which one?",
    choices: ["Red", "Blue", "Gold", "Green"],
    index,
    total: 10,
    durationMs: 20_000,
    remainingMs: 20_000,
    difficulty: 1,
  }
}

function ready(index = 0): PublicReady {
  return { index, total: 10, remainingMs: 3_000, durationMs: 3_000 }
}

function reveal(results: RevealResult[], correctIndex: ChoiceIndex = 1): PublicReveal {
  return {
    correctIndex,
    prompt: "Which one?",
    choices: ["Red", "Blue", "Gold", "Green"],
    results,
  }
}

function result(
  playerId: string,
  overrides: Partial<RevealResult> = {},
): RevealResult {
  return {
    playerId,
    name: playerId,
    choiceIndex: 1,
    correct: true,
    points: 800,
    score: 800,
    elapsedMs: 2_000,
    locked: true,
    ...overrides,
  }
}

function you(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    role: "player",
    playerId: "ada",
    name: "Ada",
    score: 0,
    choiceIndex: null,
    locked: false,
    ...overrides,
  }
}

function room(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "QUIZ",
    phase: "lobby",
    players: [],
    question: null,
    ready: null,
    reveal: null,
    you: { role: "host" },
    lanAddresses: [],
    settings: {
      questionDurationMs: 20_000,
      revealDurationMs: 8_000,
      autoAdvance: true,
      difficulty: "mixed",
    },
    revealRemainingMs: null,
    advancePaused: false,
    ...overrides,
  }
}

function frame(
  snapshot: RoomSnapshot,
  readySecond: number | null = null,
  questionSecond: number | null = null,
): HostFrame {
  return { snapshot, readySecond, questionSecond }
}

describe("displayed seconds", () => {
  it("matches the on-screen countdown", () => {
    assert.equal(displayedReadySecond(3_000), 3)
    assert.equal(displayedReadySecond(1), 1)
    assert.equal(displayedReadySecond(0), 1)
    assert.equal(displayedQuestionSecond(5_000), 5)
    assert.equal(displayedQuestionSecond(1), 1)
    assert.equal(displayedQuestionSecond(0), 0)
  })
})

describe("host cues", () => {
  it("stays silent on the first snapshot", () => {
    const lobby = frame(room({ players: [player("ada")] }))
    assert.deepEqual(hostCues(null, lobby), [])
  })

  it("chimes once when someone joins the lobby", () => {
    const empty = frame(room())
    const ada = frame(room({ players: [player("ada")] }))
    const both = frame(room({ players: [player("ada"), player("bea")] }))
    const again = frame(room({ players: [player("bea"), player("ada")] }))
    assert.deepEqual(hostCues(empty, ada), ["join"])
    assert.deepEqual(hostCues(ada, both), ["join"])
    assert.deepEqual(hostCues(both, again), [])
  })

  it("chimes once when two phones join in the same update", () => {
    const empty = frame(room())
    const both = frame(room({ players: [player("ada"), player("bea")] }))
    assert.deepEqual(hostCues(empty, both), ["join"])
  })

  it("does not chime for a player who appears after the lobby", () => {
    const asking = frame(
      room({ phase: "question", question: question(), players: [player("ada")] }),
      null,
      12,
    )
    const late = frame(
      room({
        phase: "question",
        question: question(),
        players: [player("ada"), player("bea")],
      }),
      null,
      12,
    )
    assert.deepEqual(hostCues(asking, late), [])
  })

  it("beeps on each get-ready second and not again while that second holds", () => {
    const lobby = frame(room({ players: [player("ada")] }))
    const three = frame(room({ phase: "ready", ready: ready(), players: [player("ada")] }), 3)
    const still = frame(room({ phase: "ready", ready: ready(), players: [player("ada")] }), 3)
    const two = frame(room({ phase: "ready", ready: ready(), players: [player("ada")] }), 2)
    assert.deepEqual(hostCues(lobby, three), ["ready"])
    assert.deepEqual(hostCues(three, still), [])
    assert.deepEqual(hostCues(still, two), ["ready"])
  })

  it("plays the question sting when a question opens and not on later pushes", () => {
    const waiting = frame(room({ phase: "ready", ready: ready(), players: [player("ada")] }), 1)
    const open = frame(
      room({ phase: "question", question: question(0), players: [player("ada")] }),
      null,
      20,
    )
    const later = frame(
      room({ phase: "question", question: question(0), players: [player("ada")] }),
      null,
      19,
    )
    const next = frame(
      room({ phase: "question", question: question(1), players: [player("ada")] }),
      null,
      20,
    )
    assert.deepEqual(hostCues(waiting, open), ["question"])
    assert.deepEqual(hostCues(open, later), [])
    assert.deepEqual(hostCues(later, next), ["question"])
  })

  it("ticks only while the answer timer shows the last five seconds", () => {
    const at = (second: number) =>
      frame(room({ phase: "question", question: question(), players: [player("ada")] }), null, second)
    assert.deepEqual(hostCues(at(7), at(6)), [])
    assert.deepEqual(hostCues(at(6), at(5)), ["tick"])
    assert.deepEqual(hostCues(at(5), at(5)), [])
    assert.deepEqual(hostCues(at(5), at(4)), ["tick"])
    assert.deepEqual(hostCues(at(2), at(1)), ["tick"])
    assert.deepEqual(hostCues(at(1), at(0)), [])
    const readyAtFive = frame(room({ phase: "ready", ready: ready() }), 5, 5)
    assert.deepEqual(hostCues(readyAtFive, readyAtFive), [])
  })

  it("plays the lock chord once when the table finishes locking", () => {
    const open = frame(
      room({
        phase: "question",
        question: question(),
        players: [player("ada", { locked: true }), player("bea")],
      }),
      null,
      8,
    )
    const done = frame(
      room({
        phase: "question",
        question: question(),
        players: [player("ada", { locked: true }), player("bea", { locked: true })],
      }),
      null,
      8,
    )
    const again = frame(
      room({
        phase: "question",
        question: question(),
        players: [player("ada", { locked: true }), player("bea", { locked: true })],
      }),
      null,
      7,
    )
    assert.deepEqual(hostCues(open, done), ["allLocked"])
    assert.deepEqual(hostCues(done, again), [])
  })

  it("plays the lock chord with the reveal when the last lock ends the question", () => {
    const open = frame(
      room({
        phase: "question",
        question: question(),
        players: [player("ada")],
      }),
      null,
      9,
    )
    const shown = frame(
      room({
        phase: "reveal",
        reveal: reveal([result("ada")]),
        players: [player("ada", { locked: true, score: 800 })],
      }),
    )
    assert.deepEqual(hostCues(open, shown), ["allLocked", "reveal"])
  })

  it("plays the reveal without the lock chord when the timer runs out", () => {
    const open = frame(
      room({
        phase: "question",
        question: question(),
        players: [player("ada"), player("bea", { locked: true })],
      }),
      null,
      1,
    )
    const shown = frame(
      room({
        phase: "reveal",
        reveal: reveal([result("ada", { choiceIndex: null, correct: false, points: 0 }), result("bea")]),
        players: [player("ada"), player("bea", { locked: true })],
      }),
    )
    assert.deepEqual(hostCues(open, shown), ["reveal"])
    assert.deepEqual(hostCues(shown, shown), [])
  })

  it("plays the podium sting once when the table is final", () => {
    const shown = frame(room({ phase: "reveal", reveal: reveal([result("ada")]) }))
    const final = frame(room({ phase: "finished", players: [player("ada", { score: 800 })] }))
    const held = frame(room({ phase: "finished", players: [player("ada", { score: 800 })] }))
    assert.deepEqual(hostCues(shown, final), ["podium"])
    assert.deepEqual(hostCues(final, held), [])
  })

  it("ignores a disconnected phone when deciding the table has locked", () => {
    const open = frame(
      room({
        phase: "question",
        question: question(),
        players: [player("ada"), player("bea", { connected: false })],
      }),
      null,
      10,
    )
    const done = frame(
      room({
        phase: "question",
        question: question(),
        players: [player("ada", { locked: true }), player("bea", { connected: false })],
      }),
      null,
      10,
    )
    assert.deepEqual(hostCues(open, done), ["allLocked"])
  })
})

describe("player cues", () => {
  it("stays silent on the first snapshot", () => {
    const seated = room({ phase: "lobby", you: you() })
    assert.deepEqual(playerCues(null, seated), [])
  })

  it("taps when the choice changes and clicks once on lock", () => {
    const open = room({ phase: "question", question: question(), you: you() })
    const picked = room({ phase: "question", question: question(), you: you({ choiceIndex: 0 }) })
    const changed = room({ phase: "question", question: question(), you: you({ choiceIndex: 2 }) })
    const locked = room({
      phase: "question",
      question: question(),
      you: you({ choiceIndex: 2, locked: true }),
    })
    const held = room({
      phase: "question",
      question: question(),
      you: you({ choiceIndex: 2, locked: true }),
    })
    assert.deepEqual(playerCues(open, picked), ["pick"])
    assert.deepEqual(playerCues(picked, changed), ["pick"])
    assert.deepEqual(playerCues(changed, locked), ["lock"])
    assert.deepEqual(playerCues(locked, held), [])
  })

  it("plays correct, miss, or time-up from that player's result", () => {
    const open = room({ phase: "question", question: question(), you: you({ choiceIndex: 1, locked: true }) })
    const right = room({
      phase: "reveal",
      reveal: reveal([result("ada", { correct: true })]),
      you: you({ choiceIndex: 1, locked: true, score: 800 }),
    })
    const wrongOpen = room({
      phase: "question",
      question: question(),
      you: you({ choiceIndex: 0, locked: true }),
    })
    const wrong = room({
      phase: "reveal",
      reveal: reveal([result("ada", { choiceIndex: 0, correct: false, points: 0 })]),
      you: you({ choiceIndex: 0, locked: true }),
    })
    const blankOpen = room({ phase: "question", question: question(), you: you() })
    const blank = room({
      phase: "reveal",
      reveal: reveal([result("ada", { choiceIndex: null, correct: false, points: 0, locked: false })]),
      you: you(),
    })
    assert.deepEqual(playerCues(open, right), ["correct"])
    assert.deepEqual(playerCues(wrongOpen, wrong), ["miss"])
    assert.deepEqual(playerCues(blankOpen, blank), ["timeup"])
    assert.deepEqual(playerCues(right, right), [])
  })

  it("still clicks when the last lock arrives with the reveal", () => {
    const open = room({ phase: "question", question: question(), you: you({ choiceIndex: 1 }) })
    const shown = room({
      phase: "reveal",
      reveal: reveal([result("ada")]),
      you: you({ choiceIndex: 1, locked: true, score: 800 }),
    })
    assert.deepEqual(playerCues(open, shown), ["lock", "correct"])
  })
})
