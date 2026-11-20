import type { RevealResult, RoomSettings, RoomSnapshot } from "@shared/types"
import { AnswerGrid } from "../../components"
import { useCountdown } from "../../useCountdown"
import { fmt, formatNumber, formatSeconds, t } from "../../strings"
import { ConfirmButton } from "./ConfirmButton"
import { RoundSettings } from "./HostSettings"
import { playerRows, Standings } from "./Standings"

export function RevealBoard({
  snapshot,
  busy,
  onNext,
  onPause,
  onEnd,
  onRemove,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onNext: () => void
  onPause: () => void
  onEnd: () => void
  onRemove: (playerId: string) => void
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
      <AnswerGrid choices={reveal.choices} selected={null} correctIndex={reveal.correctIndex} counts={reveal.counts} />
      <ScoreList snapshot={snapshot} busy={busy} onRemove={onRemove} />
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

function ScoreList({
  snapshot,
  busy,
  onRemove,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onRemove: (playerId: string) => void
}) {
  const results = snapshot.reveal?.results ?? []
  const byId = new Map(results.map((result) => [result.playerId, result]))
  const rows = playerRows(snapshot.players).map((row) => {
    const result = byId.get(row.id)
    const detail = result ? resultPace(result, snapshot.players.length > 12) : t.joinedLate
    const withDetail = { ...row, detail, tone: result ? (result.correct ? "gain" : "miss") : undefined } as const
    if (!row.away) return withDetail
    const name = snapshot.players.find((player) => player.id === row.id)?.name ?? row.name
    return {
      ...withDetail,
      action: (
        <ConfirmButton
          label="×"
          confirmLabel={t.removeConfirm}
          ariaLabel={fmt(t.removePlayer, { name })}
          className="chip-x"
          disabled={busy}
          onConfirm={() => onRemove(row.id)}
        />
      ),
    }
  })
  return <Standings rows={rows} />
}
