import type { CSSProperties } from "react"
import { CHOICES } from "@shared/types"
import { fmt, t } from "./strings"

export function AnswerGrid({
  choices,
  selected,
  correctIndex,
  counts,
  disabled,
  onPick,
}: {
  choices: readonly string[]
  selected: number | null
  correctIndex?: number | null
  /** Picks per choice, TV reveal only. */
  counts?: readonly number[]
  disabled?: boolean
  onPick?: (index: number) => void
}) {
  const revealed = correctIndex != null
  const total = counts ? counts.reduce((sum, n) => sum + n, 0) : 0
  return (
    <div className={onPick ? "answer-grid phone" : "answer-grid tv"} role="list">
      {choices.map((choice, index) => {
        const meta = CHOICES[index]
        if (!meta) return null
        const className = [
          "answer",
          selected === index && !revealed ? "is-selected" : "",
          revealed && index === correctIndex ? "is-correct" : "",
          revealed && selected === index && index !== correctIndex ? "is-wrong" : "",
          revealed && index !== correctIndex ? "is-dim" : "",
          counts ? "has-count" : "",
        ]
          .filter(Boolean)
          .join(" ")
        const style = { background: meta.color, color: meta.ink }
        const body = (
          <>
            <span className="letter">{meta.key}</span>
            <span className="label">{choice}</span>
            {counts && <PickCount n={counts[index] ?? 0} total={total} />}
          </>
        )
        if (!onPick) {
          return (
            <div key={meta.key} className={className} style={style} role="listitem">
              {body}
            </div>
          )
        }
        return (
          <button
            key={meta.key}
            type="button"
            className={className}
            style={style}
            disabled={disabled}
            onClick={() => onPick(index)}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}

function PickCount({ n, total }: { n: number; total: number }) {
  const style = { width: `${(n / Math.max(1, total)) * 100}%` }
  return (
    <>
      <span className="count" role="img" aria-label={fmt(t.pickedBy, { n })}>
        {n}
      </span>
      <span className="count-bar" style={style} aria-hidden="true" />
    </>
  )
}

export function TimerBar({
  remainingMs,
  durationMs,
  leftMs,
}: {
  remainingMs: number
  durationMs: number
  leftMs: number
}) {
  const ratio = durationMs <= 0 ? 0 : Math.max(0, Math.min(1, remainingMs / durationMs))
  const seconds = Math.ceil(leftMs / 1000)
  const urgent = leftMs <= 5000
  const style = { "--from": ratio, animationDuration: `${Math.max(0, remainingMs)}ms` } as CSSProperties
  return (
    <div className="timer" aria-label={t.secondsLeft(seconds)}>
      <div className="timer-track">
        <div className={urgent ? "timer-fill urgent" : "timer-fill"} key={remainingMs} style={style} />
      </div>
      <span className={urgent ? "timer-seconds urgent" : "timer-seconds"}>{seconds}</span>
    </div>
  )
}

export function joinOrigin(lanAddresses: string[]): string {
  const { protocol, hostname, port } = window.location
  const local = hostname === "localhost" || hostname === "127.0.0.1"
  const host = lanAddresses[0]
  if (local && host) return `${protocol}//${host}${port ? `:${port}` : ""}`
  return window.location.origin
}

export function joinUrl(origin: string, code: string): string {
  return `${origin}/?code=${encodeURIComponent(code)}`
}

export function formatCode(code: string): string {
  return code.split("").join(" ")
}
