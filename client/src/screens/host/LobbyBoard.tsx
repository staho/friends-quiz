import { QRCodeSVG } from "qrcode.react"
import type { PublicPlayer, RoomSettings, RoomSnapshot } from "@shared/types"
import { formatCode, joinOrigin, joinUrl } from "../../components"
import { fmt, t } from "../../strings"
import { ConfirmButton } from "./ConfirmButton"
import { RoundSettings } from "./HostSettings"

export function LobbyBoard({
  snapshot,
  busy,
  onStart,
  onRemove,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onStart: () => void
  onRemove: (playerId: string) => void
  onSettings: (settings: RoomSettings) => void
}) {
  const origin = joinOrigin(snapshot.lanAddresses)
  const url = joinUrl(origin, snapshot.code)
  return (
    <section className="lobby">
      <div className="join-row">
        <div className="join-copy">
          <p className="hint">{t.joinOnPhone}</p>
          <p className="join-url">{origin}</p>
          <p className="code" aria-label={t.roomCodeAria(snapshot.code)}>
            {formatCode(snapshot.code)}
          </p>
        </div>
        <JoinQr url={url} />
      </div>
      <PlayerStrip players={snapshot.players} busy={busy} onRemove={onRemove} />
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy || snapshot.players.length === 0} onClick={onStart}>
          {t.start}
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
        aria-label={t.scanToJoin(url)}
      />
    </div>
  )
}

function PlayerStrip({
  players,
  busy,
  onRemove,
}: {
  players: PublicPlayer[]
  busy: boolean
  onRemove: (playerId: string) => void
}) {
  if (players.length === 0) {
    return (
      <div className="lobby-players">
        <p className="hint">{t.waitingFirst}</p>
      </div>
    )
  }
  return (
    <div className="lobby-players">
      <p className="hint players-count">{t.players(players.length)}</p>
      <ul className="chips">
        {players.map((player) => (
          <li key={player.id} className={player.connected ? "chip" : "chip away"}>
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
    </div>
  )
}
