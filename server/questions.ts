import type { ChoiceIndex } from "../shared/types.ts"
import { GameError, type Question } from "./game.ts"

export function parseQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new GameError("Question pack is empty")
  }
  return raw.map((item, index) => parseQuestion(item, index))
}

function parseQuestion(raw: unknown, index: number): Question {
  if (!raw || typeof raw !== "object") throw new GameError(`Question ${index + 1} is invalid`)
  const item = raw as Record<string, unknown>
  const id = requiredString(item.id, `Question ${index + 1} is missing an id`)
  const prompt = requiredString(item.prompt, `Question ${index + 1} is missing a prompt`)
  if (!Array.isArray(item.choices) || item.choices.length !== 4) {
    throw new GameError(`Question ${index + 1} needs four answers`)
  }
  const choices = item.choices.map((choice, choiceIndex) =>
    requiredString(choice, `Question ${index + 1} answer ${choiceIndex + 1} is empty`),
  ) as [string, string, string, string]
  if (!isChoiceIndex(item.correctIndex)) {
    throw new GameError(`Question ${index + 1} has an invalid correct answer`)
  }
  return { id, prompt, choices, correctIndex: item.correctIndex }
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new GameError(message)
  return value.trim()
}

function isChoiceIndex(value: unknown): value is ChoiceIndex {
  return value === 0 || value === 1 || value === 2 || value === 3
}
