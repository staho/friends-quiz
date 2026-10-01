import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { QUESTIONS_PER_ROUND } from "../shared/types.ts"
import { listQuestions, questionsFromRows, type StatementDatabase } from "./catalog.ts"
import { GameError } from "./game.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function openSeeded(): StatementDatabase {
  const db = new DatabaseSync(":memory:")
  db.exec(readFileSync(path.join(root, "migrations/0001_questions.sql"), "utf8"))
  db.exec(readFileSync(path.join(root, "migrations/0002_seed.sql"), "utf8"))
  return {
    prepare(query: string) {
      const statement = db.prepare(query)
      const run = (...values: unknown[]) => ({
        async all<T>() {
          const results = (values.length > 0 ? statement.all(...(values as [])) : statement.all()) as T[]
          return { results }
        },
      })
      return {
        bind(...values: unknown[]) {
          return run(...values)
        },
        all<T>() {
          return run().all<T>()
        },
      }
    },
  }
}

describe("question catalog", () => {
  it("loads the seeded bank", async () => {
    const pack = await listQuestions(openSeeded())
    assert.ok(pack.length >= QUESTIONS_PER_ROUND)
    for (const item of pack) {
      assert.equal(item.choices.length, 4)
      assert.ok(item.correctIndex >= 0 && item.correctIndex <= 3)
      assert.ok(item.category.length > 0)
    }
  })

  it("leaves out questions already asked", async () => {
    const pack = await listQuestions(openSeeded(), { excludeIds: ["paris", "water"] })
    assert.equal(pack.some((item) => item.id === "paris"), false)
    assert.equal(pack.some((item) => item.id === "water"), false)
  })

  it("filters by category", async () => {
    const pack = await listQuestions(openSeeded(), { category: "geography" })
    assert.ok(pack.length > 0)
    assert.ok(pack.every((item) => item.category === "geography"))
  })

  it("rejects a question that does not have four answers", () => {
    assert.throws(
      () =>
        questionsFromRows([
          {
            id: "bad",
            prompt: "Huh?",
            category: "general",
            difficulty: 1,
            position: 0,
            text: "Only",
            is_correct: 1,
          },
        ]),
      (error: unknown) => error instanceof GameError && /four answers/.test(error.message),
    )
  })
})
