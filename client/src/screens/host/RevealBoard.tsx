import { useEffect } from "react"
import type { RevealResult, RoomSettings, RoomSnapshot } from "@shared/types"
import { AnswerGrid } from "../../components"
import { useCountdown } from "../../useCountdown"
import { formatNumber, formatSeconds, t } from "../../strings"
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
      <p className="kicker">{t.theAnswer}</p>
      <h1 className="prompt">{reveal.prompt}</h1>
      <AnswerGrid choices={reveal.choices} selected={null} correctIndex={reveal.correctIndex} />
      <ScoreList snapshot={snapshot} />
      {waiting && (
        <p className="hint">
          {snapshot.advancePaused
            ? t.holdingLeft(Math.ceil(left / 1000))
            : left <= 0
              ? t.nextNow
              : t.nextIn(Math.ceil(left / 1000))}
        </p>
      )}
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy} onClick={onNext}>
          {t.next}
        </button>
        {snapshot.settings.autoAdvance && (
          <button type="button" className="btn ghost" disabled={busy} onClick={onPause}>
            {snapshot.advancePaused ? t.resume : t.pause}
          </button>
        )}
        <button type="button" className="btn ghost" disabled={busy} onClick={onEnd}>
          {t.end}
        </button>
      </div>
      {snapshot.settings.autoAdvance && (
        <p className="hint">{snapshot.advancePaused ? t.holding : t.spacePauses}</p>
      )}
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}

function resultPace(result: RevealResult): string {
  if (result.choiceIndex == null) return t.noAnswer
  const outcome = result.correct ? `+${formatNumber(result.points)}` : t.miss
  if (typeof result.locked !== "boolean" || typeof result.elapsedMs !== "number") return outcome
  if (!result.locked) return `${outcome} · ${t.notLocked}`
  return `${outcome} · ${formatSeconds(result.elapsedMs)}`
}

function ScoreList({ snapshot }: { snapshot: RoomSnapshot }) {
  const results = [...(snapshot.reveal?.results ?? [])].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name, "pl"),
  )
  return (
    <ol className="scores">
      {results.map((result) => (
        <li key={result.playerId}>
          <span className="score-name">{result.name}</span>
          <span className={result.correct ? "gain" : "miss"}>{resultPace(result)}</span>
          <strong>{formatNumber(result.score)}</strong>
        </li>
      ))}
    </ol>
  )
}
