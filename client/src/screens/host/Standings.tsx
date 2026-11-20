import type { CSSProperties, ReactNode } from "react"
import type { PublicPlayer } from "@shared/types"
import { fmt, formatNumber, t } from "../../strings"

export interface StandingRow {
  id: string
  name: string
  score: number
  rank: number
  detail?: string
  tone?: "gain" | "miss"
  movement?: number | null
  away?: boolean
  action?: ReactNode
}

/** Rows for every player, in rank order then name. Movement is only known on the reveal board. */
export function playerRows(players: readonly PublicPlayer[]): StandingRow[] {
  return [...players]
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "pl"))
    .map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      rank: player.rank,
      movement: player.previousRank == null ? null : player.previousRank - player.rank,
      away: !player.connected,
    }))
}

export function columnsFor(n: number): number {
  return n <= 6 ? 1 : n <= 12 ? 2 : n <= 18 ? 3 : 4
}

export function Standings({ rows }: { rows: StandingRow[] }) {
  const cols = columnsFor(rows.length)
  const perColumn = Math.max(1, Math.ceil(rows.length / cols))
  const style = { "--cols": cols, "--rows": perColumn, "--fit": cols >= 3 ? 19 : 14 } as CSSProperties
  return (
    <ol className="standings" style={style}>
      {rows.map((row) => {
        const up = (row.movement ?? 0) > 0
        const classes = [row.rank <= 3 && row.score !== 0 ? `place-${row.rank}` : "", row.away ? "away" : ""].filter(Boolean).join(" ")
        return (
          <li key={row.id} className={classes || undefined}>
            <span className="st-rank">{row.rank}</span>
            {row.movement ? (
              <span
                className={up ? "st-move up" : "st-move down"}
                role="img"
                aria-label={fmt(up ? t.moveUp : t.moveDown, { n: Math.abs(row.movement) })}
              >
                {up ? "▲" : "▼"}
                {Math.abs(row.movement)}
              </span>
            ) : null}
            <span className="st-name">{row.name}</span>
            {row.detail ? <span className={row.tone ? `st-detail ${row.tone}` : "st-detail"}>{row.detail}</span> : null}
            <strong className="st-score">{formatNumber(row.score)}</strong>
            {row.action}
          </li>
        )
      })}
    </ol>
  )
}
