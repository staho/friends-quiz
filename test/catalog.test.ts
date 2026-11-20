import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { QUESTIONS_PER_ROUND } from "../shared/types.ts"
import {
  applyTick,
  createRoom,
  difficultyBounds,
  difficultyForSlot,
  joinPlayer,
  nextQuestion,
  resetRound,
  startGame,
  takeFromDeck,
  type Question,
  type Room,
} from "../server/game.ts"
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
import { sqlStatements } from "../server/sql-script.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function openMemory(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  return db
}

function migrationNames(): string[] {
  return readdirSync(path.join(root, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
}

function migrationFiles(): CatalogMigration[] {
  return migrationNames().map((name) => ({
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
  it("lists every migration file for the worker", () => {
    const generated = readFileSync(path.join(root, "worker/catalog-migrations.ts"), "utf8")
    const listed = [...generated.matchAll(/name: "([^"]+\.sql)"/g)].map((match) => match[1])
    assert.deepEqual(listed, migrationNames())
  })

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

  it("applies later migrations once on a catalog that is already seeded", () => {
    const db = openMemory()
    db.exec(readFileSync(path.join(root, "migrations/0001_questions.sql"), "utf8"))
    db.exec(readFileSync(path.join(root, "migrations/0002_seed.sql"), "utf8"))
    applyCatalogMigrations(asMigrationDatabase(db), migrationFiles())
    const categories = countRows(db, "categories")
    const questions = countRows(db, "questions")
    applyCatalogMigrations(asMigrationDatabase(db), migrationFiles())
    assert.equal(categories, 5)
    assert.equal(questions, 112)
    assert.equal(countRows(db, "categories"), categories)
    assert.equal(countRows(db, "questions"), questions)
    assert.equal(countRows(db, "question_stats"), 0)
    assert.equal(countRows(db, "question_plays"), 0)
    const applied = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all() as { name: string }[]
    assert.deepEqual(
      applied.map((row) => row.name),
      migrationNames(),
    )
  })

  it("fills every category and difficulty with at least four questions", async () => {
    const db = openMigrated()
    const categories = await listCategories(db)
    assert.deepEqual(
      categories.map((category) => category.id),
      ["common", "geography", "history", "movies", "science"],
    )
    const pack = await listQuestions(db)
    assert.equal(pack.length, 112)
    for (const category of categories) {
      for (let difficulty = 1; difficulty <= 5; difficulty += 1) {
        const cell = pack.filter((item) => item.category === category.id && item.difficulty === difficulty)
        assert.ok(cell.length >= 4, `${category.id} level ${difficulty} has ${cell.length}`)
      }
    }
  })

  it("stays inside a difficulty band", async () => {
    const db = openMigrated()
    const pack = await listQuestions(db)
    const bounds = { minDifficulty: 4, maxDifficulty: 5 }
    const picked = await pickRandomQuestion(db, [], 5, bounds)
    assert.ok(picked)
    assert.ok(picked.difficulty >= 4 && picked.difficulty <= 5)
    const levelFive = pack.filter((item) => item.difficulty === 5).map((item) => item.id)
    const inside = await pickRandomQuestion(db, levelFive, 5, bounds)
    assert.equal(inside?.difficulty, 4)
    const blocked = pack.filter((item) => item.difficulty >= 4).map((item) => item.id)
    assert.equal(await pickRandomQuestion(db, blocked, 5, bounds), null)
  })

  it("stays on an exhausted difficulty until that deck is drawn again", async () => {
    const db = openMigrated()
    const level = await listQuestions(db, { minDifficulty: 2, maxDifficulty: 2 })
    const ids = level.map((item) => item.id)
    const exact = { minDifficulty: 2, maxDifficulty: 2 }
    assert.equal(await pickRandomQuestion(db, ids, 2, exact), null)
    const fresh = await pickRandomQuestion(db, [], 2, exact)
    assert.equal(fresh?.difficulty, 2)
    assert.equal(ids.includes(fresh?.id ?? ""), true)
  })

  it("prefers the requested difficulty and falls back to the nearest level", async () => {
    const db = openMigrated()
    const levelFive = await listQuestions(db, { minDifficulty: 5, maxDifficulty: 5 })
    const exact = await pickRandomQuestion(db, [], 5)
    assert.equal(exact?.difficulty, 5)
    const fallback = await pickRandomQuestion(
      db,
      levelFive.map((item) => item.id),
      5,
    )
    assert.equal(fallback?.difficulty, 4)
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
            category_label: null,
            difficulty: 1,
            position: 0,
            text: "Only",
            is_correct: 1,
          },
        ]),
      (error: unknown) => error instanceof Error && /four answers/.test(error.message),
    )
  })
})

describe("catalog queries inside a long-running room", () => {
  function openCounted(): { db: StatementDatabase; raw: DatabaseSync; binds: number[] } {
    const raw = openMemory()
    applyCatalogMigrations(asMigrationDatabase(raw), migrationFiles())
    const inner = asStatementDatabase(raw)
    const binds: number[] = []
    const db: StatementDatabase = {
      prepare(query: string) {
        const wrap = (statement: ReturnType<StatementDatabase["prepare"]>): ReturnType<StatementDatabase["prepare"]> => ({
          bind(...values: unknown[]) {
            if (values.length > 100) throw new Error("too many SQL variables")
            binds.push(values.length)
            return wrap(statement.bind(...values))
          },
          all: (...args) => statement.all(...args),
          run: () => statement.run(),
        })
        return wrap(inner.prepare(query))
      },
    }
    return { db, raw, binds }
  }

  async function dealRound(db: StatementDatabase, start: Room, now: number): Promise<Room> {
    const pick = (excludeIds: string[], difficulty: number, bounds?: { minDifficulty: number; maxDifficulty: number }, counts?: Record<string, number>) =>
      pickRandomQuestion(db, excludeIds, difficulty, bounds, counts)
    const deal = async (room: Room): Promise<{ room: Room; question: Question | null }> =>
      takeFromDeck(room, difficultyForSlot(room.asked.length), difficultyBounds(room.difficulty), pick)
    const first = await deal(start)
    assert.ok(first.question)
    let room = startGame(first.room, first.question, now)
    let t = now
    for (let slot = 0; slot < QUESTIONS_PER_ROUND; slot += 1) {
      t += 3_000
      room = applyTick(room, t)
      assert.equal(room.phase, "question")
      t += room.activeDurationMs
      room = applyTick(room, t)
      assert.equal(room.phase, "reveal")
      if (slot === QUESTIONS_PER_ROUND - 1) break
      const dealt = await deal(room)
      assert.ok(dealt.question)
      room = nextQuestion(dealt.room, dealt.question, t)
    }
    return room
  }

  it("never binds more than three parameters across 14 rounds in one room", async () => {
    const { db, binds } = openCounted()
    let room = joinPlayer(createRoom({ code: "QUIZ", hostToken: "h" }), { id: "p1", name: "Ada", token: "t" }).room
    let now = 0
    for (let round = 0; round < 14; round += 1) {
      room = await dealRound(db, room, now)
      const ids = room.asked.map((item) => item.id)
      assert.equal(ids.length, QUESTIONS_PER_ROUND)
      assert.equal(new Set(ids).size, QUESTIONS_PER_ROUND)
      room = resetRound({ ...room, phase: "reveal" })
      now += 10 * 60_000
    }
    assert.ok(binds.length > 0)
    assert.ok(Math.max(...binds) <= 3, `max binds ${Math.max(...binds)}`)
  })

  it("spreads one round evenly over the categories", async () => {
    const { db, raw } = openCounted()
    const categories = countRows(raw, "categories")
    assert.ok(categories > 1)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const room = await dealRound(
        db,
        joinPlayer(createRoom({ code: "QUIZ", hostToken: "h" }), { id: "p1", name: "Ada", token: "t" }).room,
        0,
      )
      const counts = new Map<string, number>()
      for (const item of room.asked) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
      assert.ok(
        Math.max(...counts.values()) <= Math.ceil(QUESTIONS_PER_ROUND / categories),
        JSON.stringify([...counts]),
      )
    }
  })

  it("still deals from a category that is already over-used", async () => {
    const { db } = openCounted()
    const picked = await pickRandomQuestion(db, [], 1, undefined, { geography: 50 })
    assert.ok(picked)
  })

  it("takes the label from the categories table", async () => {
    const { db, raw } = openCounted()
    raw.prepare("UPDATE categories SET label = 'Etykieta testowa' WHERE id = (SELECT category FROM questions WHERE id = 'paris')").run()
    const [paris] = await listQuestions(db, { ids: ["paris"] })
    assert.equal(paris?.categoryLabel, "Etykieta testowa")
    const rows = [
      { id: "x", prompt: "P", category: "c", category_label: null, difficulty: 1, position: 0, text: "a", is_correct: 1 },
      { id: "x", prompt: "P", category: "c", category_label: null, difficulty: 1, position: 1, text: "b", is_correct: 0 },
      { id: "x", prompt: "P", category: "c", category_label: null, difficulty: 1, position: 2, text: "c", is_correct: 0 },
      { id: "x", prompt: "P", category: "c", category_label: null, difficulty: 1, position: 3, text: "d", is_correct: 0 },
    ]
    assert.equal(questionsFromRows(rows)[0]?.categoryLabel, "c")
  })
})
