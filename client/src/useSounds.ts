import { useEffect, useRef } from "react"
import type { RoomSnapshot } from "@shared/types"
import { displayedQuestionSecond, displayedReadySecond, hostCues, playerCues, type HostFrame } from "./cues"
import { playCue } from "./sound"
import { useCountdown } from "./useCountdown"

const STAGGER_S = 0.28

export function useHostSounds(snapshot: RoomSnapshot | null): void {
  const readyMs = snapshot?.phase === "ready" && snapshot.ready ? snapshot.ready.remainingMs : null
  const questionMs =
    snapshot?.phase === "question" && snapshot.question ? snapshot.question.remainingMs : null
  const readyLeft = useCountdown(readyMs, readyMs != null)
  const questionLeft = useCountdown(questionMs, questionMs != null)
  const readySecond = readyMs != null ? displayedReadySecond(readyLeft) : null
  const questionSecond = questionMs != null ? displayedQuestionSecond(questionLeft) : null
  const prev = useRef<HostFrame | null>(null)

  useEffect(() => {
    if (!snapshot) return
    const next = { snapshot, readySecond, questionSecond }
    hostCues(prev.current, next).forEach((cue, index) => playCue(cue, index * STAGGER_S))
    prev.current = next
  }, [snapshot, readySecond, questionSecond])
}

export function usePlayerSounds(snapshot: RoomSnapshot | null): void {
  const prev = useRef<RoomSnapshot | null>(null)

  useEffect(() => {
    if (!snapshot || snapshot.you.role !== "player") return
    playerCues(prev.current, snapshot).forEach((cue, index) => playCue(cue, index * STAGGER_S))
    prev.current = snapshot
  }, [snapshot])
}
