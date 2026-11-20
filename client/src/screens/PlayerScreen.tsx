import { useEffect, useState, type FormEvent } from "react"
import { useCountdown } from "../useCountdown"
import type { PlayerSession, RevealResult, RoomSnapshot } from "@shared/types"
import { AnswerGrid, formatCode } from "../components"
import { MuteButton } from "../MuteButton"
import { request, socket } from "../socket"
import { errorCode } from "../errors"
import { useRoom } from "../useRoom"
import { usePlayerSounds } from "../useSounds"
import { formatNumber, t } from "../strings"

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
          const code = errorCode(err)
          if (code === "room_not_found" || code === "rejoin") {
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
      setError(err instanceof Error ? err.message : t.couldNotJoin)
    } finally {
      setBusy(false)
    }
  }

  const playing = snapshot?.you.role === "player" ? snapshot : null
  usePlayerSounds(playing)

  return (
    <main className="stage phone">
      {!connected && <p className="banner">{t.reconnecting}</p>}
      {error && <p className="banner">{error}</p>}
      {restoring ? (
        <p className="waiting">{t.findingSeat}</p>
      ) : playing ? (
        <>
          <div className="phone-tools">
            <MuteButton />
          </div>
          <Play snapshot={playing} onError={setError} />
        </>
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
          <p className="eyebrow">{t.appName}</p>
          <h1>{t.joinTitle}</h1>
          <label>
            {t.roomCode}
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
            {t.yourName}
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
            {t.join}
          </button>
          <button type="button" className="btn ghost" onClick={() => window.location.assign("/host")}>
            {t.hostGame}
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
      onError(err instanceof Error ? err.message : t.tryAgain)
    } finally {
      setBusy(false)
    }
  }

  if (snapshot.phase === "lobby") {
    return (
      <section className="phone-wait">
        <p className="eyebrow">{t.youreIn}</p>
        <h1>{you.name}</h1>
        <p className="code small">{formatCode(snapshot.code)}</p>
        <p className="hint">{t.tvStarts}</p>
        <PlayerNames snapshot={snapshot} />
        <button type="button" className="btn ghost" onClick={leave}>
          {t.leave}
        </button>
      </section>
    )
  }

  if (snapshot.phase === "ready" && snapshot.ready) {
    return <GetReady ready={snapshot.ready} />
  }

  if (snapshot.phase === "question" && snapshot.question) {
    const question = snapshot.question
    return (
      <section className="phone-play">
        <header className="phone-head">
          <span>
            {t.progress(question.index + 1, question.total)}
          </span>
          <strong>{formatNumber(you.score)}</strong>
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
          <p className="hint">{you.locked ? t.lockedIn : t.canChange}</p>
          <button
            type="button"
            className="btn primary"
            disabled={busy || you.locked || you.choiceIndex == null}
            onClick={() => void act(() => request((ack) => socket.emit("player:lock", ack)))}
          >
            {you.locked ? t.lockedIn : t.lockIn}
          </button>
        </div>
      </section>
    )
  }

  if (snapshot.phase === "reveal") {
    const mine = snapshot.reveal?.results.find((result) => result.playerId === you.playerId)
    const title =
      mine == null || mine.choiceIndex == null ? t.timesUp : mine.correct ? t.correctGain(mine.points) : t.wrong
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
          {t.yourScore} <strong>{formatNumber(you.score)}</strong>
        </p>
        {mine && <p className="hint">{paceHint(mine)}</p>}
      </section>
    )
  }

  const ahead = snapshot.players.filter((player) => player.score > you.score).length
  return (
    <section className="phone-wait">
      <p className="eyebrow">{t.roundOver}</p>
      <h1>
        {t.finalLine(ahead + 1, you.score)}
      </h1>
      <p className="hint">{t.scoresOnTv}</p>
      <button type="button" className="btn ghost" onClick={leave}>
        {t.leave}
      </button>
    </section>
  )
}

function GetReady({ ready }: { ready: NonNullable<RoomSnapshot["ready"]> }) {
  const left = useCountdown(ready.remainingMs, true)
  const count = Math.max(1, Math.ceil(left / 1000))
  return (
    <section className="phone-wait">
      <p className="eyebrow">{t.getReady}</p>
      <h1 className="ready-count" aria-live="polite">
        {count}
      </h1>
      <p className="hint">{t.questionOf(ready.index + 1, ready.total)}</p>
    </section>
  )
}

function paceHint(result: RevealResult): string {
  if (result.choiceIndex == null || result.locked !== true || typeof result.elapsedMs !== "number") {
    return t.noLockPace
  }
  return t.lockedAt(result.elapsedMs)
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
