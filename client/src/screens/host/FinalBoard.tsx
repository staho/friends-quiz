import type { PublicPlayer, RoomSettings, RoomSnapshot } from "@shared/types"
import { RoundSettings } from "./HostSettings"

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
  return (
    <section className="board final">
      <p className="kicker">Final table</p>
      <Podium players={snapshot.players} />
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy} onClick={onReset}>
          New round
        </button>
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}

function Podium({ players }: { players: PublicPlayer[] }) {
  const ranked = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  if (ranked.length === 0) return <p className="hint">Nobody played.</p>
  return (
    <ol className="podium">
      {ranked.map((player, index) => (
        <li key={player.id} className={index < 3 ? `place place-${index + 1}` : "place"}>
          <span className="place-rank">{index + 1}</span>
          <span className="place-name">{player.name}</span>
          <strong>{player.score}</strong>
        </li>
      ))}
    </ol>
  )
}
