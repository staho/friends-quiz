import { CHOICES } from "@shared/types"

export function AnswerGrid({
  choices,
  selected,
  correctIndex,
  disabled,
  onPick,
}: {
  choices: readonly string[]
  selected: number | null
  correctIndex?: number | null
  disabled?: boolean
  onPick?: (index: number) => void
}) {
  const revealed = correctIndex != null
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
        ]
          .filter(Boolean)
          .join(" ")
        const style = { background: meta.color, color: meta.ink }
        const body = (
          <>
            <span className="letter">{meta.key}</span>
            <span className="label">{choice}</span>
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

export function TimerBar({ leftMs, durationMs }: { leftMs: number; durationMs: number }) {
  const ratio = durationMs <= 0 ? 0 : Math.max(0, Math.min(1, leftMs / durationMs))
  const seconds = Math.ceil(leftMs / 1000)
  const urgent = seconds <= 5
  return (
    <div className="timer" aria-label={`${seconds} seconds left`}>
      <div className="timer-track">
        <div
          className={urgent ? "timer-fill urgent" : "timer-fill"}
          style={{ width: `${ratio * 100}%` }}
        />
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

export function formatCode(code: string): string {
  return code.split("").join(" ")
}
