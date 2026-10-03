import { useEffect, useState } from "react"
import {
  ANSWER_TIME_MAX_MS,
  ANSWER_TIME_MIN_MS,
  DIFFICULTY_BANDS,
  NEXT_TIME_MAX_MS,
  NEXT_TIME_MIN_MS,
  type DifficultyBand,
  type HostSession,
  type PublicPlayer,
  type RoomSettings,
  type RoomSnapshot,
} from "@shared/types"
import { AnswerGrid, TimerBar, formatCode, joinOrigin } from "../components"
import { request, socket } from "../socket"
import { useCountdown } from "../useCountdown"
import { useRoom } from "../useRoom"

const HOST_KEY = "friends-quiz-host"

let hostAttempt: Promise<void> | null = null

export function HostScreen() {
  const { snapshot, connected } = useRoom()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const boot = () => {
      void openOrAttach()
        .then(() => setError(null))
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Could not open a room")
        })
    }
    socket.on("connect", boot)
    if (socket.connected) boot()
    return () => {
      socket.off("connect", boot)
    }
  }, [])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try that again")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="stage tv">
      <p className="eyebrow">Friends quiz</p>
      {!connected && <p className="banner">Reconnecting to the table…</p>}
      {error && <p className="banner">{error}</p>}
      {!snapshot ? (
        <p className="waiting">Setting the table…</p>
      ) : (
        <HostBody
          snapshot={snapshot}
          busy={busy}
          onStart={() => run(() => request((ack) => socket.emit("host:start", ack)))}
          onNext={() => run(() => request((ack) => socket.emit("host:next", ack)))}
          onEnd={() => run(() => request((ack) => socket.emit("host:end", ack)))}
          onReset={() => run(() => request((ack) => socket.emit("host:reset", ack)))}
          onSettings={(settings) => run(() => request((ack) => socket.emit("host:settings", settings, ack)))}
        />
      )}
    </main>
  )
}

function HostBody({
  snapshot,
  busy,
  onStart,
  onNext,
  onEnd,
  onReset,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onStart: () => void
  onNext: () => void
  onEnd: () => void
  onReset: () => void
  onSettings: (settings: RoomSettings) => void
}) {
  if (snapshot.phase === "lobby") {
    const origin = joinOrigin(snapshot.lanAddresses)
    return (
      <section className="lobby">
        <p className="hint">Join on your phone</p>
        <p className="join-url">{origin}</p>
        <p className="code" aria-label={`Room code ${snapshot.code}`}>
          {formatCode(snapshot.code)}
        </p>
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

  if (snapshot.phase === "question" && snapshot.question) {
    return <QuestionBoard snapshot={snapshot} busy={busy} onEnd={onEnd} onSettings={onSettings} />
  }

  if (snapshot.phase === "reveal" && snapshot.reveal) {
    return (
      <RevealBoard snapshot={snapshot} busy={busy} onNext={onNext} onEnd={onEnd} onSettings={onSettings} />
    )
  }

  return (
    <section className="board">
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

function RevealBoard({
  snapshot,
  busy,
  onNext,
  onEnd,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onNext: () => void
  onEnd: () => void
  onSettings: (settings: RoomSettings) => void
}) {
  const reveal = snapshot.reveal
  const left = useCountdown(snapshot.revealRemainingMs, snapshot.settings.autoAdvance)
  if (!reveal) return null
  return (
    <section className="board">
      <p className="kicker">The answer</p>
      <h1 className="prompt">{reveal.prompt}</h1>
      <AnswerGrid choices={reveal.choices} selected={null} correctIndex={reveal.correctIndex} />
      <ScoreList snapshot={snapshot} />
      {snapshot.settings.autoAdvance && snapshot.revealRemainingMs != null && (
        <p className="hint">{left <= 0 ? "Next question now" : `Next question in ${Math.ceil(left / 1000)}s`}</p>
      )}
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy} onClick={onNext}>
          Next
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onEnd}>
          End
        </button>
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}

function QuestionBoard({
  snapshot,
  busy,
  onEnd,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onEnd: () => void
  onSettings: (settings: RoomSettings) => void
}) {
  const question = snapshot.question
  const left = useCountdown(question?.remainingMs ?? null, question != null)
  if (!question) return null
  const active = snapshot.players.filter((player) => player.connected)
  const locked = active.filter((player) => player.locked).length
  return (
    <section className="board">
      <p className="kicker">
        Question {question.index + 1} of {question.total} · Level {question.difficulty}
      </p>
      <h1 className="prompt">{question.prompt}</h1>
      <TimerBar leftMs={left} durationMs={question.durationMs} />
      <AnswerGrid choices={question.choices} selected={null} />
      <p className="hint">
        {locked} of {active.length} locked in
      </p>
      <div className="controls">
        <button type="button" className="btn ghost" disabled={busy} onClick={onEnd}>
          End
        </button>
      </div>
      <RoundSettings snapshot={snapshot} busy={busy} onSettings={onSettings} />
    </section>
  )
}

const BAND_LABEL: Record<DifficultyBand, string> = {
  mixed: "Mixed",
  "1-2": "1–2",
  "2-4": "2–4",
  "4-5": "4–5",
}

function RoundSettings({
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
      <summary>Round settings</summary>
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
        label="Answer time"
        hint="seconds"
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
        Automatic next question
      </label>
      <SecondsField
        label="Time to the next question"
        hint="seconds after the answer"
        ms={settings.revealDurationMs}
        minMs={NEXT_TIME_MIN_MS}
        maxMs={NEXT_TIME_MAX_MS}
        disabled={busy}
        onMs={(revealDurationMs) => onSettings({ ...settings, revealDurationMs })}
      />
      <div className="setting">
        <span className="setting-label">Difficulty</span>
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
  hint: string
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
        <span className="field-hint">{hint}</span>
      </span>
    </label>
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

function ScoreList({ snapshot }: { snapshot: RoomSnapshot }) {
  const results = [...(snapshot.reveal?.results ?? [])].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  )
  return (
    <ol className="scores">
      {results.map((result) => (
        <li key={result.playerId}>
          <span>{result.name}</span>
          <span className={result.correct ? "gain" : "miss"}>
            {result.choiceIndex == null ? "no answer" : result.correct ? `+${result.points}` : "miss"}
          </span>
          <strong>{result.score}</strong>
        </li>
      ))}
    </ol>
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

function openOrAttach(): Promise<void> {
  if (hostAttempt) return hostAttempt
  hostAttempt = bindHost().finally(() => {
    hostAttempt = null
  })
  return hostAttempt
}

async function bindHost(): Promise<void> {
  const saved = readHost()
  if (saved) {
    try {
      await request<HostSession>((ack) => socket.emit("host:attach", saved, ack))
      return
    } catch {
      sessionStorage.removeItem(HOST_KEY)
    }
  }
  const session = await request<HostSession>((ack) => socket.emit("host:create", ack))
  sessionStorage.setItem(HOST_KEY, JSON.stringify(session))
}

function readHost(): HostSession | null {
  const raw = sessionStorage.getItem(HOST_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as HostSession
    if (!parsed.code || !parsed.hostToken) return null
    return parsed
  } catch {
    return null
  }
}
