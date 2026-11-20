import type { RoomSettings, RoomSnapshot } from "@shared/types"
import { AnswerGrid, TimerBar } from "../../components"
import { useCountdown } from "../../useCountdown"
import { fmt, t } from "../../strings"
import { ConfirmButton } from "./ConfirmButton"
import { RoundSettings } from "./HostSettings"

export function QuestionBoard({
  snapshot,
  busy,
  onEnd,
  onRemove,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onEnd: () => void
  onRemove: (playerId: string) => void
  onSettings: (settings: RoomSettings) => void
}) {
  const question = snapshot.question
  const left = useCountdown(question?.remainingMs ?? null, question != null)
  if (!question) return null
  const active = snapshot.players.filter((player) => player.connected)
  const locked = active.filter((player) => player.locked)
  const waiting = active.filter((player) => !player.locked)
  return (
    <section className="board question">
      <div className="kicker-row">
        <p className="kicker">{t.questionKicker(question.index + 1, question.total, question.difficulty)}</p>
        {question.category !== "" && <span className="category-chip">{t.categoryLabel(question.category)}</span>}
      </div>
      <h1 className="prompt">{question.prompt}</h1>
      <TimerBar remainingMs={question.remainingMs} durationMs={question.durationMs} leftMs={left} />
      <AnswerGrid choices={question.choices} selected={null} />
      <p className="hint">{t.lockedCount(locked.length, active.length)}</p>
      {waiting.length > 0 && (
        <ul className="chips waiting-chips">
          {waiting.map((player) => (
            <li key={player.id} className="chip">
              {player.name}
              <ConfirmButton
                label="×"
                confirmLabel={t.removeConfirm}
                ariaLabel={fmt(t.removePlayer, { name: player.name })}
                className="chip-x"
                disabled={busy}
                onConfirm={() => onRemove(player.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="controls">
        <ConfirmButton label={t.end} confirmLabel={t.endConfirm} disabled={busy} onConfirm={onEnd} />
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}
