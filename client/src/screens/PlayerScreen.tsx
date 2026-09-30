import { useEffect, useState, type FormEvent } from "react"
import type { PlayerSession, RoomSnapshot } from "@shared/types"
import { AnswerGrid, formatCode } from "../components"
import { request, socket } from "../socket"
import { useRoom } from "../useRoom"

const PLAYER_KEY = "friends-quiz-player"

export function PlayerScreen() {
  const { snapshot, connected } = useRoom()
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(hasSavedPlayer)

  useEffect(() => {
    const sync = () => {
      const urlCode = initialCode()
      const saved = readPlayer()
      if (saved && urlCode && saved.code !== urlCode) sessionStorage.removeItem(PLAYER_KEY)
      const current = readPlayer()
      if (!current || (urlCode && current.code !== urlCode)) {
        setRestoring(false)
        return
      }
      void request<PlayerSession>((ack) =>
        socket.emit(
          "player:attach",
          { code: current.code, playerId: current.playerId, token: current.token },
          ack,
        ),
      )
        .then((session) => {
          sessionStorage.setItem(PLAYER_KEY, JSON.stringify(session))
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : ""
          if (message === "Room not found" || message === "Rejoin the room") {
            sessionStorage.removeItem(PLAYER_KEY)
          }
        })
        .finally(() => setRestoring(false))
    }
    socket.on("connect", sync)
    if (socket.connected) sync()
    return () => {
      socket.off("connect", sync)
    }
  }, [])

  async function join(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await request<PlayerSession>((ack) =>
        socket.emit("player:join", { code, name }, ack),
      )
      sessionStorage.setItem(PLAYER_KEY, JSON.stringify(session))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join")
    } finally {
      setBusy(false)
    }
  }

  const playing = snapshot?.you.role === "player" ? snapshot : null

  return (
    <main className="stage phone">
      {!connected && <p className="banner">Reconnecting…</p>}
      {error && <p className="banner">{error}</p>}
      {restoring ? (
        <p className="waiting">Finding your seat…</p>
      ) : playing ? (
        <Play snapshot={playing} onError={setError} />
      ) : (
        <form
          className="join"
          method="post"
          action="#"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            void join(event)
          }}
        >
          <p className="eyebrow">Friends quiz</p>
          <h1>Grab a seat</h1>
          <label>
            Room code
            <input
              name="quiz-room-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
              autoComplete="quiz-room-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={4}
              required
            />
          </label>
          <label>
            Your name
            <input
              name="quiz-player-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="quiz-player-name"
              maxLength={16}
              required
              autoFocus={code.length === 4}
            />
          </label>
          <button type="submit" className="btn primary" disabled={busy}>
            Join
          </button>
        </form>
      )}
    </main>
  )
}

function Play({
  snapshot,
  onError,
}: {
  snapshot: RoomSnapshot
  onError: (message: string | null) => void
}) {
  const you = snapshot.you.role === "player" ? snapshot.you : null
  const [busy, setBusy] = useState(false)
  if (!you) return null

  async function act(run: () => Promise<unknown>) {
    setBusy(true)
    onError(null)
    try {
      await run()
    } catch (err) {
      onError(err instanceof Error ? err.message : "Try that again")
    } finally {
      setBusy(false)
    }
  }

  if (snapshot.phase === "lobby") {
    return (
      <section className="phone-wait">
        <p className="eyebrow">You're in</p>
        <h1>{you.name}</h1>
        <p className="code small">{formatCode(snapshot.code)}</p>
        <p className="hint">The TV starts the round.</p>
        <PlayerNames snapshot={snapshot} />
        <button type="button" className="btn ghost" onClick={leave}>
          Leave
        </button>
      </section>
    )
  }

  if (snapshot.phase === "question" && snapshot.question) {
    const question = snapshot.question
    return (
      <section className="phone-play">
        <header className="phone-head">
          <span>
            {question.index + 1} / {question.total}
          </span>
          <strong>{you.score}</strong>
        </header>
        <AnswerGrid
          choices={question.choices}
          selected={you.choiceIndex}
          disabled={busy || you.locked}
          onPick={(choiceIndex) =>
            void act(() => request((ack) => socket.emit("player:choose", { choiceIndex }, ack)))
          }
        />
        <div className="lockbar">
          <p className="hint">{you.locked ? "Locked in" : "You can change it until you lock in."}</p>
          <button
            type="button"
            className="btn primary"
            disabled={busy || you.locked || you.choiceIndex == null}
            onClick={() => void act(() => request((ack) => socket.emit("player:lock", ack)))}
          >
            {you.locked ? "Locked in" : "Lock in"}
          </button>
        </div>
      </section>
    )
  }

  if (snapshot.phase === "reveal") {
    const mine = snapshot.reveal?.results.find((result) => result.playerId === you.playerId)
    const title =
      mine == null || mine.choiceIndex == null ? "Time's up" : mine.correct ? `Yes — +${mine.points}` : "Not this time"
    return (
      <section className="phone-wait">
        <p className="eyebrow">{you.name}</p>
        <h1>{title}</h1>
        {snapshot.reveal && (
          <AnswerGrid
            choices={snapshot.reveal.choices}
            selected={you.choiceIndex}
            correctIndex={snapshot.reveal.correctIndex}
          />
        )}
        <p className="score-line">
          Your score <strong>{you.score}</strong>
        </p>
      </section>
    )
  }

  const ahead = snapshot.players.filter((player) => player.score > you.score).length
  return (
    <section className="phone-wait">
      <p className="eyebrow">That's the round</p>
      <h1>
        {placeLabel(ahead + 1)} · {you.score}
      </h1>
      <p className="hint">Scores stay on the TV.</p>
      <button type="button" className="btn ghost" onClick={leave}>
        Leave
      </button>
    </section>
  )
}

function leave(): void {
  sessionStorage.removeItem(PLAYER_KEY)
  window.location.assign("/")
}

function PlayerNames({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <ul className="chips">
      {snapshot.players.map((player) => (
        <li key={player.id} className="chip">
          {player.name}
        </li>
      ))}
    </ul>
  )
}

function placeLabel(place: number): string {
  if (place === 1) return "1st"
  if (place === 2) return "2nd"
  if (place === 3) return "3rd"
  return `${place}th`
}

function initialCode(): string {
  return new URLSearchParams(window.location.search).get("code")?.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) ?? ""
}

function hasSavedPlayer(): boolean {
  const saved = readPlayer()
  const urlCode = initialCode()
  return Boolean(saved && (!urlCode || saved.code === urlCode))
}

function readPlayer(): PlayerSession | null {
  const raw = sessionStorage.getItem(PLAYER_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PlayerSession
    if (!parsed.code || !parsed.playerId || !parsed.token) return null
    return parsed
  } catch {
    return null
  }
}
