import { useState } from "react"
import {
  ANSWER_TIME_MAX_MS,
  ANSWER_TIME_MIN_MS,
  DIFFICULTY_BANDS,
  NEXT_TIME_MAX_MS,
  NEXT_TIME_MIN_MS,
  type DifficultyBand,
  type RoomSettings,
  type RoomSnapshot,
} from "@shared/types"
import { t } from "../../strings"

const BAND_LABEL: Record<DifficultyBand, string> = {
  mixed: t.bandMixed,
  "1-2": "1–2",
  "2-4": "2–4",
  "4-5": "4–5",
}

export function RoundSettings({
  snapshot,
  busy,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onSettings: (settings: RoomSettings) => void
}) {
  return (
    <details className="settings-fold">
      <summary>{t.roundSettings}</summary>
      <SettingsFields settings={snapshot.settings} busy={busy} onSettings={onSettings} />
    </details>
  )
}

function SettingsFields({
  settings,
  busy,
  onSettings,
}: {
  settings: RoomSettings
  busy: boolean
  onSettings: (settings: RoomSettings) => void
}) {
  return (
    <div className="settings-fields">
      <SecondsField
        label={t.answerTime}
        hint={t.secondsUnit}
        ms={settings.questionDurationMs}
        minMs={ANSWER_TIME_MIN_MS}
        maxMs={ANSWER_TIME_MAX_MS}
        disabled={busy}
        onMs={(questionDurationMs) => onSettings({ ...settings, questionDurationMs })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={settings.autoAdvance}
          disabled={busy}
          onChange={(event) => onSettings({ ...settings, autoAdvance: event.target.checked })}
        />
        {t.autoNext}
      </label>
      <SecondsField
        label={t.nextTime}
        hint={t.nextTimeHint}
        ms={settings.revealDurationMs}
        minMs={NEXT_TIME_MIN_MS}
        maxMs={NEXT_TIME_MAX_MS}
        disabled={busy}
        onMs={(revealDurationMs) => onSettings({ ...settings, revealDurationMs })}
      />
      <div className="setting">
        <span className="setting-label">{t.difficulty}</span>
        <div className="bands">
          {DIFFICULTY_BANDS.map((band) => (
            <button
              key={band}
              type="button"
              className={settings.difficulty === band ? "btn primary" : "btn ghost"}
              aria-pressed={settings.difficulty === band}
              disabled={busy}
              onClick={() => onSettings({ ...settings, difficulty: band })}
            >
              {BAND_LABEL[band]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function SecondsField({
  label,
  hint,
  ms,
  minMs,
  maxMs,
  disabled,
  onMs,
}: {
  label: string
  hint: (seconds: number | null) => string
  ms: number
  minMs: number
  maxMs: number
  disabled: boolean
  onMs: (ms: number) => void
}) {
  const seconds = Math.round(ms / 1000)
  const min = minMs / 1000
  const max = maxMs / 1000
  const [draft, setDraft] = useState(String(seconds))
  const [source, setSource] = useState(ms)
  if (ms !== source) {
    setSource(ms)
    setDraft(String(seconds))
  }
  return (
    <label className="setting">
      {label}
      <span className="seconds">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            const parsed = Number(next)
            if (Number.isInteger(parsed) && parsed >= min && parsed <= max) onMs(parsed * 1000)
          }}
        />
        <span className="field-hint">{hint(Number.isInteger(Number(draft)) && draft.trim() !== "" ? Number(draft) : null)}</span>
      </span>
    </label>
  )
}
