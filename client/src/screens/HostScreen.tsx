import { useEffect, useState } from "react"
import { REVEAL_HOLD_MS, type HostSession, type PublicPlayer, type RoomSnapshot } from "@shared/types"
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
          onPause={() => run(() => request((ack) => socket.emit("host:pause", ack)))}
          onEnd={() => run(() => request((ack) => socket.emit("host:end", ack)))}
          onReset={() => run(() => request((ack) => socket.emit("host:reset", ack)))}
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
  onPause,
  onEnd,
  onReset,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onStart: () => void
  onNext: () => void
  onPause: () => void
  onEnd: () => void
  onReset: () => void
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
        <div className="controls">
          <button type="button" className="btn primary" disabled={busy || snapshot.players.length === 0} onClick={onStart}>
            Start
          </button>
        </div>
      </section>
    )
  }

  if (snapshot.phase === "question" && snapshot.question) {
    return (
      <QuestionBoard snapshot={snapshot} busy={busy} onEnd={onEnd} />
    )
  }

  if (snapshot.phase === "reveal" && snapshot.reveal) {
    return (
      <RevealBoard snapshot={snapshot} busy={busy} onNext={onNext} onPause={onPause} onEnd={onEnd} />
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
    </section>
  )
}

function RevealBoard({
  snapshot,
  busy,
  onNext,
  onPause,
  onEnd,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onNext: () => void
  onPause: () => void
  onEnd: () => void
}) {
  const holdMs = snapshot.advanceRemainingMs
  const left = useCountdown(holdMs, holdMs != null && !snapshot.advancePaused)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || busy) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      onPause()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, onPause])

  if (!snapshot.reveal) return null
  return (
    <section className="board">
      <p className="kicker">The answer</p>
      <h1 className="prompt">{snapshot.reveal.prompt}</h1>
      <AnswerGrid choices={snapshot.reveal.choices} selected={null} correctIndex={snapshot.reveal.correctIndex} />
      <ScoreList snapshot={snapshot} />
      {holdMs != null && <TimerBar leftMs={left} durationMs={REVEAL_HOLD_MS} />}
      <div className="controls">
        <button type="button" className="btn primary" disabled={busy} onClick={onNext}>
          Next
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onPause}>
          {snapshot.advancePaused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onEnd}>
          End
        </button>
      </div>
      <p className="hint">{snapshot.advancePaused ? "Holding the answer" : "Space pauses"}</p>
    </section>
  )
}

function QuestionBoard({
  snapshot,
  busy,
  onEnd,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onEnd: () => void
}) {
  const question = snapshot.question
  const left = useCountdown(question?.remainingMs ?? null, question != null)
  if (!question) return null
  const active = snapshot.players.filter((player) => player.connected)
  const locked = active.filter((player) => player.locked).length
  return (
    <section className="board">
      <p className="kicker">
        Question {question.index + 1} of {question.total}
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
    </section>
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
