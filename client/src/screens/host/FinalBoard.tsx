import type { RoomSettings, RoomSnapshot } from "@shared/types"
import { t } from "../../strings"
import { RoundSettings } from "./HostSettings"
import { rankRows, Standings } from "./Standings"

export function FinalBoard({
  snapshot,
  busy,
  onReset,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onReset: () => void
  onSettings: (settings: RoomSettings) => void
}) {
  const rows = rankRows(snapshot.players)
  return (
    <section className="board final">
      <p className="kicker">{t.finalTable}</p>
      {rows.length === 0 ? <p className="hint">{t.nobodyPlayed}</p> : <Standings rows={rows} />}
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy} onClick={onReset}>
          {t.newRound}
        </button>
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}
