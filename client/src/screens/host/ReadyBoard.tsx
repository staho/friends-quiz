import type { RoomSettings, RoomSnapshot } from "@shared/types"
import { useCountdown } from "../../useCountdown"
import { RoundSettings } from "./HostSettings"

export function ReadyBoard({
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
  const ready = snapshot.ready
  const left = useCountdown(ready?.remainingMs ?? null, ready != null)
  if (!ready) return null
  const count = Math.max(1, Math.ceil(left / 1000))
  return (
    <section className="board">
      <p className="kicker">
        Question {ready.index + 1} of {ready.total}
      </p>
      <h1 className="prompt">Get ready</h1>
      <p className="ready-count" aria-live="polite">
        {count}
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
