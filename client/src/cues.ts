import type { RoomSnapshot } from "@shared/types"

export type HostCue = "join" | "ready" | "question" | "tick" | "allLocked" | "reveal" | "podium"

export type PlayerCue = "pick" | "lock" | "correct" | "miss" | "timeup"

export type Cue = HostCue | PlayerCue

export interface HostFrame {
  snapshot: RoomSnapshot
  readySecond: number | null
  questionSecond: number | null
}

export function displayedReadySecond(leftMs: number): number {
  return Math.max(1, Math.ceil(leftMs / 1000))
}

export function displayedQuestionSecond(leftMs: number): number {
  return Math.ceil(leftMs / 1000)
}

export function hostCues(prev: HostFrame | null, next: HostFrame): HostCue[] {
  if (!prev || prev.snapshot.code !== next.snapshot.code) return []
  const cues: HostCue[] = []

  if (next.snapshot.phase === "lobby" && joined(prev.snapshot, next.snapshot)) cues.push("join")

  if (
    next.snapshot.phase === "ready" &&
    next.readySecond != null &&
    next.readySecond !== prev.readySecond
  ) {
    cues.push("ready")
  }

  if (questionOpened(prev.snapshot, next.snapshot)) cues.push("question")

  if (
    next.snapshot.phase === "question" &&
    next.questionSecond != null &&
    next.questionSecond >= 1 &&
    next.questionSecond <= 5 &&
    next.questionSecond !== prev.questionSecond
  ) {
    cues.push("tick")
  }

  if (justLockedTable(prev.snapshot, next.snapshot)) cues.push("allLocked")

  if (prev.snapshot.phase !== "reveal" && next.snapshot.phase === "reveal") cues.push("reveal")

  if (prev.snapshot.phase !== "finished" && next.snapshot.phase === "finished") cues.push("podium")

  return cues
}

export function playerCues(prev: RoomSnapshot | null, next: RoomSnapshot): PlayerCue[] {
  if (!prev || prev.code !== next.code) return []
  if (next.you.role !== "player") return []
  const you = next.you
  const prevYou =
    prev.you.role === "player" && prev.you.playerId === you.playerId ? prev.you : null
  if (!prevYou) return []

  const cues: PlayerCue[] = []
  if (next.phase === "question" && you.choiceIndex != null && you.choiceIndex !== prevYou.choiceIndex) {
    cues.push("pick")
  }
  if (!prevYou.locked && you.locked) cues.push("lock")

  if (prev.phase !== "reveal" && next.phase === "reveal") {
    const mine = next.reveal?.results.find((result) => result.playerId === you.playerId)
    if (mine == null || mine.choiceIndex == null) cues.push("timeup")
    else if (mine.correct) cues.push("correct")
    else cues.push("miss")
  }

  return cues
}

function joined(prev: RoomSnapshot, next: RoomSnapshot): boolean {
  const seen = new Set(prev.players.map((player) => player.id))
  return next.players.some((player) => !seen.has(player.id))
}

function questionOpened(prev: RoomSnapshot, next: RoomSnapshot): boolean {
  if (next.phase !== "question" || next.question == null) return false
  if (prev.phase !== "question" || prev.question == null) return true
  return prev.question.index !== next.question.index
}

function justLockedTable(prev: RoomSnapshot, next: RoomSnapshot): boolean {
  if (prev.phase !== "question" || tableLocked(prev)) return false
  if (next.phase !== "question" && next.phase !== "reveal") return false
  return tableLocked(next)
}

function tableLocked(snapshot: RoomSnapshot): boolean {
  const active = snapshot.players.filter((player) => player.connected)
  return active.length > 0 && active.every((player) => player.locked)
}
