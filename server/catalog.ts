import type { ChoiceIndex } from "../shared/types.ts"
import { GameError, type Question } from "./game.ts"
import { sqlStatements } from "./sql-script.ts"

const BASELINE_MIGRATIONS = ["0001_questions.sql", "0002_seed.sql"]

export interface Category {
  id: string
  label: string
}

export interface QuestionFilter {
  excludeIds?: readonly string[]
  ids?: readonly string[]
  category?: string
  minDifficulty?: number
  maxDifficulty?: number
}

export interface Statement {
  bind(...values: unknown[]): Statement
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ changes: number }>
}

export interface StatementDatabase {
  prepare(query: string): Statement
}

export interface MigrationDatabase {
  exec(query: string): void
  all<T>(query: string, ...values: unknown[]): T[]
  run(query: string, ...values: unknown[]): void
}

export interface CatalogMigration {
  name: string
  sql: string
}

export interface QuestionPlay {
  playId: string
  questionId: string
  correct: number
  incorrect: number
}

export interface QuestionStat {
  questionId: string
  timesAsked: number
  correctCount: number
  incorrectCount: number
}

interface QuestionStatRow {
  question_id: string
  times_asked: number
  correct_count: number
  incorrect_count: number
}

function readPlayText(value: string, label: string): string {
  const text = value.trim()
  if (!text) throw new GameError(`Missing ${label}`)
  return text
}

function readPlayCount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new GameError(`Invalid ${label}`)
  return value
}

interface QuestionRow {
  id: string
  prompt: string
  category: string
  difficulty: number
  position: number
  text: string
  is_correct: number
}

export function applyCatalogMigrations(db: MigrationDatabase, migrations: readonly CatalogMigration[]): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)")
  const hasCategories =
    db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'categories'").length > 0
  const applied = new Set(db.all<{ name: string }>("SELECT name FROM schema_migrations").map((row) => row.name))
  if (hasCategories && applied.size === 0) {
    for (const name of BASELINE_MIGRATIONS) {
      db.run("INSERT INTO schema_migrations (name) VALUES (?)", name)
      applied.add(name)
    }
  }
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue
    for (const statement of sqlStatements(migration.sql)) db.exec(statement)
    db.run("INSERT INTO schema_migrations (name) VALUES (?)", migration.name)
    applied.add(migration.name)
  }
}

export async function recordQuestionPlay(db: StatementDatabase, play: QuestionPlay): Promise<boolean> {
  const playId = readPlayText(play.playId, "play")
  const questionId = readPlayText(play.questionId, "question")
  const correct = readPlayCount(play.correct, "correct count")
  const incorrect = readPlayCount(play.incorrect, "incorrect count")
  const inserted = await db
    .prepare("INSERT INTO question_plays (play_id, question_id) VALUES (?, ?) ON CONFLICT(play_id) DO NOTHING")
    .bind(playId, questionId)
    .run()
  if (inserted.changes === 0) return false
  await db
    .prepare(
      `INSERT INTO question_stats (question_id, times_asked, correct_count, incorrect_count)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET
         times_asked = times_asked + 1,
         correct_count = correct_count + excluded.correct_count,
         incorrect_count = incorrect_count + excluded.incorrect_count`,
    )
    .bind(questionId, correct, incorrect)
    .run()
  return true
}

export async function listQuestionStats(db: StatementDatabase): Promise<QuestionStat[]> {
  const result = await db
    .prepare(
      `SELECT question_id, times_asked, correct_count, incorrect_count
       FROM question_stats
       ORDER BY question_id`,
    )
    .all<QuestionStatRow>()
  return result.results.map((row) => ({
    questionId: row.question_id,
    timesAsked: Number(row.times_asked),
    correctCount: Number(row.correct_count),
    incorrectCount: Number(row.incorrect_count),
  }))
}

export async function listCategories(db: StatementDatabase): Promise<Category[]> {
  const result = await db.prepare("SELECT id, label FROM categories ORDER BY label").all<Category>()
  return result.results
}

export async function pickRandomQuestion(
  db: StatementDatabase,
  excludeIds: readonly string[] = [],
): Promise<Question | null> {
  const conditions = ["active = 1"]
  const params: unknown[] = []
  if (excludeIds.length > 0) {
    conditions.push(`id NOT IN (${excludeIds.map(() => "?").join(", ")})`)
    params.push(...excludeIds)
  }
  const statement = db.prepare(
    `SELECT id FROM questions WHERE ${conditions.join(" AND ")} ORDER BY RANDOM() LIMIT 1`,
  )
  const picked =
    params.length > 0 ? await statement.bind(...params).all<{ id: string }>() : await statement.all<{ id: string }>()
  const id = picked.results[0]?.id
  if (!id) return null
  const questions = await listQuestions(db, { ids: [id] })
  return questions[0] ?? null
}

export async function listQuestions(
  db: StatementDatabase,
  filter: QuestionFilter = {},
): Promise<Question[]> {
  const conditions = ["q.active = 1"]
  const params: unknown[] = []
  if (filter.category) {
    conditions.push("q.category = ?")
    params.push(filter.category)
  }
  if (filter.minDifficulty != null) {
    conditions.push("q.difficulty >= ?")
    params.push(filter.minDifficulty)
  }
  if (filter.maxDifficulty != null) {
    conditions.push("q.difficulty <= ?")
    params.push(filter.maxDifficulty)
  }
  const exclude = filter.excludeIds ?? []
  if (exclude.length > 0) {
    conditions.push(`q.id NOT IN (${exclude.map(() => "?").join(", ")})`)
    params.push(...exclude)
  }
  const ids = filter.ids ?? []
  if (ids.length > 0) {
    conditions.push(`q.id IN (${ids.map(() => "?").join(", ")})`)
    params.push(...ids)
  }
  const sql = `
    SELECT
      q.id,
      q.prompt,
      q.category,
      q.difficulty,
      c.position,
      c.text,
      c.is_correct
    FROM questions q
    INNER JOIN choices c ON c.question_id = q.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY q.id, c.position
  `
  const statement = db.prepare(sql)
  const result = params.length > 0 ? await statement.bind(...params).all<QuestionRow>() : await statement.all<QuestionRow>()
  return questionsFromRows(result.results)
}

export function questionsFromRows(rows: readonly QuestionRow[]): Question[] {
  const grouped = new Map<string, QuestionRow[]>()
  for (const row of rows) {
    const existing = grouped.get(row.id)
    if (existing) existing.push(row)
    else grouped.set(row.id, [row])
  }
  return [...grouped.values()].map((group) => questionFromRows(group))
}

function questionFromRows(rows: readonly QuestionRow[]): Question {
  const first = rows[0]
  if (!first) throw new GameError("Question is missing")
  const choices = readChoices(first.id, rows)
  const text = readQuestionText(first)
  return {
    id: first.id,
    prompt: text.prompt,
    choices: choices.choices,
    correctIndex: choices.correctIndex,
    category: text.category,
    difficulty: Number(first.difficulty),
  }
}

function readChoices(
  id: string,
  rows: readonly QuestionRow[],
): { choices: [string, string, string, string]; correctIndex: ChoiceIndex } {
  if (rows.length !== 4) throw new GameError(`Question ${id} needs four answers`)
  const choices = ["", "", "", ""] as [string, string, string, string]
  let correctIndex: ChoiceIndex | null = null
  for (const row of rows) {
    const slot = readChoiceSlot(id, row)
    if (choices[slot.position] !== "") throw new GameError(`Question ${id} repeats an answer slot`)
    choices[slot.position] = slot.text
    if (!slot.correct) continue
    if (correctIndex != null) throw new GameError(`Question ${id} has more than one correct answer`)
    correctIndex = slot.position
  }
  if (correctIndex == null) throw new GameError(`Question ${id} has no correct answer`)
  return { choices, correctIndex }
}

function readChoiceSlot(id: string, row: QuestionRow): { position: ChoiceIndex; text: string; correct: boolean } {
  if (!isChoiceIndex(row.position)) throw new GameError(`Question ${id} has an invalid answer slot`)
  const text = row.text.trim()
  if (!text) throw new GameError(`Question ${id} has an empty answer`)
  return { position: row.position, text, correct: Number(row.is_correct) === 1 }
}

function readQuestionText(row: QuestionRow): { prompt: string; category: string } {
  const prompt = row.prompt.trim()
  const category = row.category.trim()
  if (!prompt) throw new GameError(`Question ${row.id} is missing a prompt`)
  if (!category) throw new GameError(`Question ${row.id} is missing a category`)
  return { prompt, category }
}

function isChoiceIndex(value: number): value is ChoiceIndex {
  return value === 0 || value === 1 || value === 2 || value === 3
}
