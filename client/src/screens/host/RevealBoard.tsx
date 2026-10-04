import { useEffect } from "react"
import type { RevealResult, RoomSettings, RoomSnapshot } from "@shared/types"
import { AnswerGrid, formatLockSeconds } from "../../components"
import { useCountdown } from "../../useCountdown"
import { RoundSettings } from "./HostSettings"

export function RevealBoard({
  snapshot,
  busy,
  onNext,
  onPause,
  onEnd,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onNext: () => void
  onPause: () => void
  onEnd: () => void
  onSettings: (settings: RoomSettings) => void
}) {
  const reveal = snapshot.reveal
  const counting = snapshot.settings.autoAdvance && !snapshot.advancePaused
  const left = useCountdown(snapshot.revealRemainingMs, counting)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || busy || !snapshot.settings.autoAdvance) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      onPause()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, onPause, snapshot.settings.autoAdvance])

  if (!reveal) return null
  const waiting = snapshot.settings.autoAdvance && snapshot.revealRemainingMs != null
  return (
    <section className="board reveal">
      <p className="kicker">The answer</p>
      <h1 className="prompt">{reveal.prompt}</h1>
      <AnswerGrid choices={reveal.choices} selected={null} correctIndex={reveal.correctIndex} />
      <ScoreList snapshot={snapshot} />
      {waiting && (
        <p className="hint">
          {snapshot.advancePaused
            ? `Holding the answer · ${Math.ceil(left / 1000)}s left`
            : left <= 0
              ? "Next question now"
              : `Next question in ${Math.ceil(left / 1000)}s`}
        </p>
      )}
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy} onClick={onNext}>
          Next
        </button>
        {snapshot.settings.autoAdvance && (
          <button type="button" className="btn ghost" disabled={busy} onClick={onPause}>
            {snapshot.advancePaused ? "Resume" : "Pause"}
          </button>
        )}
        <button type="button" className="btn ghost" disabled={busy} onClick={onEnd}>
          End
        </button>
      </div>
      {snapshot.settings.autoAdvance && (
        <p className="hint">{snapshot.advancePaused ? "Holding the answer" : "Space pauses"}</p>
      )}
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}

function resultPace(result: RevealResult): string {
  if (result.choiceIndex == null) return "no answer"
  const outcome = result.correct ? `+${result.points}` : "miss"
  if (typeof result.locked !== "boolean" || typeof result.elapsedMs !== "number") return outcome
  if (!result.locked) return `${outcome} · didn't lock`
  return `${outcome} · ${formatLockSeconds(result.elapsedMs)}`
}

function ScoreList({ snapshot }: { snapshot: RoomSnapshot }) {
  const results = [...(snapshot.reveal?.results ?? [])].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  )
  return (
    <ol className="scores">
      {results.map((result) => (
        <li key={result.playerId}>
          <span className="score-name">{result.name}</span>
          <span className={result.correct ? "gain" : "miss"}>{resultPace(result)}</span>
          <strong>{result.score}</strong>
        </li>
      ))}
    </ol>
  )
}
