import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createRoom,
  roundCategoryCounts,
  shuffleChoices,
  startGame,
  takeFromDeck,
  type Question,
} from "../server/game.ts"

const original: Question = {
  id: "q1",
  prompt: "Which?",
  choices: ["Red", "Blue", "Gold", "Green"],
  correctIndex: 2,
  category: "colours",
  categoryLabel: "Kolory",
  difficulty: 1,
}

function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

describe("shuffling answers", () => {
  it("keeps the correct answer text and every other field", () => {
    const rng = seeded(7)
    for (let i = 0; i < 100; i += 1) {
      const shuffled = shuffleChoices(original, rng)
      assert.equal(shuffled.choices[shuffled.correctIndex], "Gold")
      assert.deepEqual([...shuffled.choices].sort(), [...original.choices].sort())
      assert.equal(shuffled.id, "q1")
      assert.equal(shuffled.prompt, "Which?")
      assert.equal(shuffled.category, "colours")
      assert.equal(shuffled.categoryLabel, "Kolory")
    }
    assert.equal(original.correctIndex, 2)
    assert.deepEqual(original.choices, ["Red", "Blue", "Gold", "Green"])
  })

  it("puts the correct answer in every position often enough", () => {
    const rng = seeded(11)
    const hits = [0, 0, 0, 0]
    for (let i = 0; i < 400; i += 1) hits[shuffleChoices(original, rng).correctIndex] += 1
    for (const count of hits) assert.ok(count >= 60, hits.join(","))
  })

  it("deals a shuffled copy that stays consistent in the room", async () => {
    const room = createRoom({ code: "QUIZ", hostToken: "h" })
    const rng = seeded(3)
    const seen = new Set<string>()
    for (let i = 0; i < 20; i += 1) {
      const dealt = await takeFromDeck(room, 1, null, async () => original, rng)
      assert.ok(dealt.question)
      assert.equal(dealt.question.choices[dealt.question.correctIndex], "Gold")
      seen.add(dealt.question.choices.join("|"))
    }
    assert.ok(seen.size > 1)
    assert.equal(original.correctIndex, 2)
  })

  it("passes the round's category counts to the picker", async () => {
    let room = createRoom({ code: "QUIZ", hostToken: "h" })
    room = { ...startGame({ ...room, players: [{ id: "p", name: "A", score: 0, connected: true, token: "t", left: false }] }, original, 0) }
    assert.deepEqual(roundCategoryCounts(room), { colours: 1 })
    let received: Record<string, number> | undefined
    await takeFromDeck(room, 1, null, async (_ex, _d, _b, counts) => {
      received = counts
      return original
    })
    assert.deepEqual(received, { colours: 1 })
  })
})
