import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { RoomSettings, RoomSnapshot } from "@shared/types"
import { formatNumber, t } from "../../strings"
import { playCue } from "../../sound"
import { RoundSettings } from "./HostSettings"
import { podiumSteps, type PodiumStep } from "./podium"
import { columnsFor, playerRows, Standings } from "./Standings"

/** Seconds after the board opens at which each step (third, second, first) appears. */
const STEP_DELAYS_S = [0.8, 2.0, 3.4]

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

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
  const steps = podiumSteps(snapshot.players)
  // Shown from the lowest step up; `stage` counts how many are on screen.
  const reveal = [...steps].reverse()
  const [stage, setStage] = useState(() => (reducedMotion() ? reveal.length : 0))
  const count = useRef(reveal.length)
  count.current = reveal.length

  useEffect(() => {
    const n = count.current
    if (n === 0) return
    if (reducedMotion()) {
      playCue("podium")
      return
    }
    const timers = STEP_DELAYS_S.slice(0, n).map((delay, index) =>
      window.setTimeout(() => {
        setStage(index + 1)
        playCue(index === n - 1 ? "podium" : "reveal")
      }, delay * 1000),
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const onPodium = new Set(steps.flatMap((step) => step.players.map((player) => player.id)))
  const rest = playerRows(snapshot.players.filter((player) => !onPodium.has(player.id)))
  const shown = new Set(reveal.slice(0, stage).map((step) => step.place))
  return (
    <section className="board final">
      <p className="kicker">{t.finalTable}</p>
      {snapshot.players.length === 0 ? (
        <p className="hint">{t.nobodyPlayed}</p>
      ) : (
        <div
          className={rest.length > 0 && steps.length > 0 ? "final-body with-rest" : "final-body"}
          style={{ "--rest-rows": Math.ceil(rest.length / columnsFor(rest.length)) } as CSSProperties}
        >
          {steps.length > 0 && <Podium steps={steps} shown={shown} />}
          {rest.length > 0 && <Standings rows={rest} />}
        </div>
      )}
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy} onClick={onReset}>
          {t.newRound}
        </button>
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}

function Podium({ steps, shown }: { steps: PodiumStep[]; shown: Set<number> }) {
  // 2nd left, 1st centre, 3rd right.
  const order = [2, 1, 3]
    .map((place) => steps.find((step) => step.place === place))
    .filter((step): step is PodiumStep => step != null)
  return (
    <div className="podium" role="list" aria-label={t.podiumTitle}>
      {order.map((step) => (
        <div
          key={step.place}
          className={shown.has(step.place) ? `step step-${step.place} shown` : `step step-${step.place}`}
          role="listitem"
        >
          <div className="step-who">
            <p className="step-names">{step.players.map((player) => player.name).join(", ")}</p>
            <strong className="step-score">{formatNumber(step.players[0]?.score ?? 0)}</strong>
          </div>
          <div className="step-block">{step.place}</div>
        </div>
      ))}
    </div>
  )
}
