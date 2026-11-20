import type { RevealResult, RoomSettings, RoomSnapshot } from "@shared/types"
import { AnswerGrid } from "../../components"
import { useCountdown } from "../../useCountdown"
import { formatNumber, formatSeconds, t } from "../../strings"
import { ConfirmButton } from "./ConfirmButton"
import { RoundSettings } from "./HostSettings"
import { rankRows, Standings, type StandingRow } from "./Standings"

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

  if (!reveal) return null
  const waiting = snapshot.settings.autoAdvance && snapshot.revealRemainingMs != null
  return (
    <section className="board reveal">
      <p className="kicker">{t.theAnswer}</p>
      <h1 className="prompt">{reveal.prompt}</h1>
      <AnswerGrid choices={reveal.choices} selected={null} correctIndex={reveal.correctIndex} />
      <ScoreList snapshot={snapshot} />
      <div className="board-foot">
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
          <ConfirmButton label={t.end} confirmLabel={t.endConfirm} disabled={busy} onConfirm={onEnd} />
          {snapshot.settings.autoAdvance && (
            <p className="hint keys-hint">{snapshot.advancePaused ? t.holding : t.keysHint}</p>
          )}
        </div>
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}

/** `compact` keeps only the outcome, for a crowded table where each row is narrow. */
function resultPace(result: RevealResult, compact: boolean): string {
  if (result.choiceIndex == null) return t.noAnswer
  const outcome = result.correct ? `+${formatNumber(result.points)}` : t.miss
  if (compact) return outcome
  if (typeof result.locked !== "boolean" || typeof result.elapsedMs !== "number") return outcome
  if (!result.locked) return `${outcome} · ${t.notLocked}`
  return `${outcome} · ${formatSeconds(result.elapsedMs)}`
}

function ScoreList({ snapshot }: { snapshot: RoomSnapshot }) {
  const results = snapshot.reveal?.results ?? []
  const byId = new Map(results.map((result) => [result.playerId, result]))
  const rows: StandingRow[] = rankRows(results.map((r) => ({ id: r.playerId, name: r.name, score: r.score }))).map(
    (row) => {
      const result = byId.get(row.id)
      return result ? { ...row, detail: resultPace(result, results.length > 12), tone: result.correct ? "gain" : "miss" } : row
    },
  )
  return <Standings rows={rows} />
}
