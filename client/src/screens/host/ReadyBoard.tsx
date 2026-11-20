import type { RoomSettings, RoomSnapshot } from "@shared/types"
import { useCountdown } from "../../useCountdown"
import { t } from "../../strings"
import { ConfirmButton } from "./ConfirmButton"
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
      <p className="kicker">{t.questionOf(ready.index + 1, ready.total)}</p>
      <h1 className="prompt">{t.getReady}</h1>
      <p className="ready-count" aria-live="polite">
        {count}
      </p>
      <div className="controls">
        <ConfirmButton label={t.end} confirmLabel={t.endConfirm} disabled={busy} onConfirm={onEnd} />
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}
