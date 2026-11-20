import type { CSSProperties, ReactNode } from "react"
import { formatNumber } from "../../strings"

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

/** Sorts by score (then name) and gives competition ranks: 1, 2, 2, 4. */
export function rankRows(players: readonly { id: string; name: string; score: number }[]): StandingRow[] {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pl"))
  let rank = 0
  return sorted.map((player, index) => {
    if (index === 0 || player.score !== sorted[index - 1]?.score) rank = index + 1
    return { id: player.id, name: player.name, score: player.score, rank }
  })
}

export function columnsFor(n: number): number {
  return n <= 6 ? 1 : n <= 12 ? 2 : n <= 18 ? 3 : 4
}

export function Standings({ rows }: { rows: StandingRow[] }) {
  const cols = columnsFor(rows.length)
  const perColumn = Math.max(1, Math.ceil(rows.length / cols))
  const style = { "--cols": cols, "--rows": perColumn } as CSSProperties
  return (
    <ol className="standings" style={style}>
      {rows.map((row) => {
        const classes = [row.rank <= 3 && row.score !== 0 ? `place-${row.rank}` : "", row.away ? "away" : ""].filter(Boolean).join(" ")
        return (
          <li key={row.id} className={classes || undefined}>
            <span className="st-rank">{row.rank}</span>
            {row.movement ? <span className="st-move">{row.movement > 0 ? "▲" : "▼"}{Math.abs(row.movement)}</span> : null}
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
