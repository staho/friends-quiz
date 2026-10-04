import type { RoomSettings, RoomSnapshot } from "@shared/types"
import { AnswerGrid, TimerBar } from "../../components"
import { useCountdown } from "../../useCountdown"
import { RoundSettings } from "./HostSettings"

export function QuestionBoard({
  snapshot,
  busy,
  onEnd,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onEnd: () => void
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
      <p className="kicker">
        Question {question.index + 1} of {question.total} · Level {question.difficulty}
      </p>
      <h1 className="prompt">{question.prompt}</h1>
      <TimerBar leftMs={left} durationMs={question.durationMs} />
      <AnswerGrid choices={question.choices} selected={null} />
      <p className="hint">
        {locked.length} of {active.length} locked in
        {waiting.length > 0 ? ` · waiting on ${waiting.map((player) => player.name).join(", ")}` : ""}
      </p>
      <div className="controls">
        <button type="button" className="btn ghost" disabled={busy} onClick={onEnd}>
          End
        </button>
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}
