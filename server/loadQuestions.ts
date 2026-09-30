import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseQuestions } from "./questions.ts"
import type { Question } from "./game.ts"

const packPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/questions.json")

export function loadQuestionPack(): Question[] {
  const raw: unknown = JSON.parse(readFileSync(packPath, "utf8"))
  return parseQuestions(raw)
}
