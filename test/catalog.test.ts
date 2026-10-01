import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { QUESTIONS_PER_ROUND } from "../shared/types.ts"
import {
  applyCatalogMigrations,
  listCategories,
  listQuestionStats,
  listQuestions,
  pickRandomQuestion,
  questionsFromRows,
  recordQuestionPlay,
  type CatalogMigration,
  type MigrationDatabase,
  type StatementDatabase,
} from "../server/catalog.ts"
import { GameError } from "../server/game.ts"
import { sqlStatements } from "../server/sql-script.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function openMemory(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

function migrationFiles(): CatalogMigration[] {
  return ["0001_questions.sql", "0002_seed.sql", "0003_question_stats.sql"].map((name) => ({
    name,
    sql: readFileSync(path.join(root, "migrations", name), "utf8"),
  }))
}

function asMigrationDatabase(db: DatabaseSync): MigrationDatabase {
  return {
    exec(query: string) {
      db.exec(query)
    },
    all<T>(query: string, ...values: unknown[]): T[] {
      const statement = db.prepare(query)
      return (values.length > 0 ? statement.all(...(values as [])) : statement.all()) as T[]
    },
    run(query: string, ...values: unknown[]) {
      const statement = db.prepare(query)
      if (values.length > 0) statement.run(...(values as []))
      else statement.run()
    },
  }
}

function openSeeded(): StatementDatabase {
  const db = openMemory()
  db.exec(readFileSync(path.join(root, "migrations/0001_questions.sql"), "utf8"))
  db.exec(readFileSync(path.join(root, "migrations/0002_seed.sql"), "utf8"))
  return asStatementDatabase(db)
}

function openMigrated(): StatementDatabase {
  const db = openMemory()
  applyCatalogMigrations(asMigrationDatabase(db), migrationFiles())
  return asStatementDatabase(db)
}

function asStatementDatabase(db: DatabaseSync): StatementDatabase {
  return {
    prepare(query: string) {
      const statement = db.prepare(query)
      const bound = (...values: unknown[]) => ({
        bind(...next: unknown[]) {
          return bound(...next)
        },
        async all<T>() {
          const results = (values.length > 0 ? statement.all(...(values as [])) : statement.all()) as T[]
          return { results }
        },
        async run() {
          const result = values.length > 0 ? statement.run(...(values as [])) : statement.run()
          return { changes: Number(result.changes) }
        },
      })
      return bound()
    },
  }
}

function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  return Number(row.n)
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

  it("applies the migrations one statement at a time", () => {
    const db = new DatabaseSync(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    const schema = readFileSync(path.join(root, "migrations/0001_questions.sql"), "utf8")
    const seed = readFileSync(path.join(root, "migrations/0002_seed.sql"), "utf8")
    for (const statement of [...sqlStatements(schema), ...sqlStatements(seed)]) db.exec(statement)
    const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }
    assert.equal(count.n, 9)
  })

  it("reads categories from their own table", async () => {
    const categories = await listCategories(openSeeded())
    assert.deepEqual(
      categories.map((category) => category.id),
      ["arts", "food", "general", "geography", "language", "math", "nature", "science", "sports"],
    )
    assert.equal(categories.find((category) => category.id === "geography")?.label, "Geography")
  })

  it("draws one unused question", async () => {
    const db = openSeeded()
    const pack = await listQuestions(db)
    const keep = pack[0]
    assert.ok(keep)
    const picked = await pickRandomQuestion(
      db,
      pack.filter((item) => item.id !== keep.id).map((item) => item.id),
    )
    assert.equal(picked?.id, keep.id)
    assert.deepEqual(picked?.choices, keep.choices)
    assert.ok(await pickRandomQuestion(db))
  })

  it("filters by category", async () => {
    const pack = await listQuestions(openSeeded(), { category: "geography" })
    assert.ok(pack.length > 0)
    assert.ok(pack.every((item) => item.category === "geography"))
  })

  it("adds question stats to a catalog that is already seeded", () => {
    const db = openMemory()
    db.exec(readFileSync(path.join(root, "migrations/0001_questions.sql"), "utf8"))
    db.exec(readFileSync(path.join(root, "migrations/0002_seed.sql"), "utf8"))
    const categories = countRows(db, "categories")
    const questions = countRows(db, "questions")
    applyCatalogMigrations(asMigrationDatabase(db), migrationFiles())
    applyCatalogMigrations(asMigrationDatabase(db), migrationFiles())
    assert.equal(countRows(db, "categories"), categories)
    assert.equal(countRows(db, "questions"), questions)
    assert.equal(countRows(db, "question_stats"), 0)
    assert.equal(countRows(db, "question_plays"), 0)
    const applied = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all() as { name: string }[]
    assert.deepEqual(
      applied.map((row) => row.name),
      ["0001_questions.sql", "0002_seed.sql", "0003_question_stats.sql"],
    )
  })

  it("counts a new play once and leaves an unanswered play off the answer totals", async () => {
    const db = openMigrated()
    assert.equal(
      await recordQuestionPlay(db, { playId: "QUIZ:round:paris", questionId: "paris", correct: 2, incorrect: 1 }),
      true,
    )
    assert.equal(
      await recordQuestionPlay(db, { playId: "QUIZ:round:paris", questionId: "paris", correct: 9, incorrect: 9 }),
      false,
    )
    assert.equal(
      await recordQuestionPlay(db, { playId: "QUIZ:later:paris", questionId: "paris", correct: 0, incorrect: 0 }),
      true,
    )
    const stats = await listQuestionStats(db)
    assert.deepEqual(stats, [
      { questionId: "paris", timesAsked: 2, correctCount: 2, incorrectCount: 1 },
    ])
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
