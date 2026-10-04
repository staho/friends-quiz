import { QRCodeSVG } from "qrcode.react"
import type { PublicPlayer, RoomSettings, RoomSnapshot } from "@shared/types"
import { formatCode, joinOrigin, joinUrl } from "../../components"
import { RoundSettings } from "./HostSettings"

export function LobbyBoard({
  snapshot,
  busy,
  onStart,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onStart: () => void
  onSettings: (settings: RoomSettings) => void
}) {
  const origin = joinOrigin(snapshot.lanAddresses)
  const url = joinUrl(origin, snapshot.code)
  return (
    <section className="lobby">
      <div className="join-row">
        <div className="join-copy">
          <p className="hint">Join on your phone</p>
          <p className="join-url">{origin}</p>
          <p className="code" aria-label={`Room code ${snapshot.code}`}>
            {formatCode(snapshot.code)}
          </p>
        </div>
        <JoinQr url={url} />
      </div>
      <PlayerStrip players={snapshot.players} />
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy || snapshot.players.length === 0} onClick={onStart}>
          Start
        </button>
      </div>
    </section>
  )
}

function JoinQr({ url }: { url: string }) {
  return (
    <div className="join-qr">
      <QRCodeSVG
        value={url}
        size={220}
        level="H"
        marginSize={4}
        bgColor="#ffffff"
        fgColor="#1a120c"
        role="img"
        aria-label={`Scan to join ${url}`}
      />
    </div>
  )
}

function PlayerStrip({ players }: { players: PublicPlayer[] }) {
  if (players.length === 0) return <p className="hint">Waiting for the first phone.</p>
  return (
    <ul className="chips">
      {players.map((player) => (
        <li key={player.id} className={player.connected ? "chip" : "chip away"}>
          {player.name}
        </li>
      ))}
    </ul>
  )
}
