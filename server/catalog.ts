import { GameError, type Question } from "./game.ts"
import type { ChoiceIndex } from "../shared/types.ts"

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

export interface StatementDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
    }
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  }
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
  if (rows.length !== 4) throw new GameError(`Question ${first.id} needs four answers`)
  const choices = ["", "", "", ""] as [string, string, string, string]
  let correctIndex: ChoiceIndex | null = null
  for (const row of rows) {
    if (!isChoiceIndex(row.position)) throw new GameError(`Question ${first.id} has an invalid answer slot`)
    if (choices[row.position] !== "") throw new GameError(`Question ${first.id} repeats an answer slot`)
    const text = row.text.trim()
    if (!text) throw new GameError(`Question ${first.id} has an empty answer`)
    choices[row.position] = text
    if (Number(row.is_correct) === 1) {
      if (correctIndex != null) throw new GameError(`Question ${first.id} has more than one correct answer`)
      correctIndex = row.position
    }
  }
  if (correctIndex == null) throw new GameError(`Question ${first.id} has no correct answer`)
  const prompt = first.prompt.trim()
  const category = first.category.trim()
  if (!prompt) throw new GameError(`Question ${first.id} is missing a prompt`)
  if (!category) throw new GameError(`Question ${first.id} is missing a category`)
  return {
    id: first.id,
    prompt,
    choices,
    correctIndex,
    category,
    difficulty: Number(first.difficulty),
  }
}

function isChoiceIndex(value: number): value is ChoiceIndex {
  return value === 0 || value === 1 || value === 2 || value === 3
}
