import { useEffect, useRef, useState, type FormEvent } from "react"
import { useCountdown } from "../useCountdown"
import type { PlayerSession, PlayerView, PublicQuestion, RevealResult, RoomSnapshot } from "@shared/types"
import { AnswerGrid, TimerBar, formatCode } from "../components"
import { MuteButton } from "../MuteButton"
import { request, socket } from "../socket"
import { errorCode, errorText } from "../errors"
import { chooseSession, forgetPlayer, migrateLegacyPlayer, placeText, prunePlayers, savePlayer } from "../playerSession"
import { retryDelayMs } from "../hostSession"
import { local } from "../storage"
import { useRoom } from "../useRoom"
import { usePlayerSounds } from "../useSounds"
import { formatNumber, formatPoints, t } from "../strings"
import { ConfirmButton } from "./host/ConfirmButton"

export function PlayerScreen() {
  const { snapshot, connected } = useRoom()
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(hasSavedPlayer)
  const wasPlayer = useRef<{ code: string; name: string } | null>(null)

  useEffect(() => {
    const store = local()
    migrateLegacyPlayer(store, sessionOrNull())
    prunePlayers(store, Date.now())
    let alive = true
    let run = 0
    let timer = 0
    let attempt = 0
    const sync = () => {
      window.clearTimeout(timer)
      const current = chooseSession(store, initialCode())
      if (!current) {
        setRestoring(false)
        return
      }
      const mine = ++run
      void request<PlayerSession>((ack) =>
        socket.emit("player:attach", { code: current.code, playerId: current.playerId, token: current.token }, ack),
      )
        .then((session) => {
          if (!alive || mine !== run) return
          attempt = 0
          savePlayer(store, session, Date.now())
          setRestoring(false)
        })
        .catch((err: unknown) => {
          if (!alive || mine !== run) return
          const failure = errorCode(err)
          if (failure === "room_not_found" || failure === "rejoin") {
            forgetPlayer(store, current.code)
            setCode(current.code)
            setName(current.name)
            setNotice(failure === "room_not_found" ? t.roomGone : t.seatLost)
            setRestoring(false)
            return
          }
          setRestoring(true)
          timer = window.setTimeout(sync, retryDelayMs(attempt++))
        })
    }
    const onConnect = () => {
      attempt = 0
      sync()
    }
    socket.on("connect", onConnect)
    if (socket.connected) sync()
    return () => {
      alive = false
      window.clearTimeout(timer)
      socket.off("connect", onConnect)
    }
  }, [])

  const you = snapshot?.you
  useEffect(() => {
    if (!snapshot || !you) return
    if (you.role === "player") {
      wasPlayer.current = { code: snapshot.code, name: you.name }
    } else if (you.role === "guest" && wasPlayer.current) {
      const gone = wasPlayer.current
      wasPlayer.current = null
      forgetPlayer(local(), gone.code)
      setCode(gone.code)
      setName(gone.name)
      setNotice(t.removedByHost)
    }
  }, [snapshot, you])

  async function join(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await request<PlayerSession>((ack) => socket.emit("player:join", { code, name }, ack))
      savePlayer(local(), session, Date.now())
      setNotice(null)
    } catch (err) {
      setError(errorText(errorCode(err)))
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
      {notice && !playing && <p className="banner">{notice}</p>}
      {restoring ? (
        <p className="waiting">{t.findingSeat}</p>
      ) : playing ? (
        <>
          <div className="phone-tools">
            {inRound(playing.phase) && (
              <ConfirmButton
                label={t.leave}
                confirmLabel={t.leaveConfirm}
                className="btn ghost phone-leave"
                onConfirm={() => leave(playing.code)}
              />
            )}
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
  if (!you) return null

  if (snapshot.phase === "lobby") {
    return (
      <section className="phone-wait">
        <p className="eyebrow">{t.youreIn}</p>
        <h1>{you.name}</h1>
        <p className="code small">{formatCode(snapshot.code)}</p>
        <p className="hint">{t.tvStarts}</p>
        <PlayerNames snapshot={snapshot} />
        <button type="button" className="btn ghost" onClick={() => leave(snapshot.code)}>
          {t.leave}
        </button>
      </section>
    )
  }

  if (snapshot.phase === "ready" && snapshot.ready) {
    return <GetReady ready={snapshot.ready} />
  }

  if (snapshot.phase === "question" && snapshot.question) {
    return (
      <QuestionView
        key={snapshot.question.index}
        question={snapshot.question}
        you={you}
        onError={onError}
      />
    )
  }

  if (snapshot.phase === "reveal") {
    const mine = snapshot.reveal?.results.find((result) => result.playerId === you.playerId)
    const title =
      mine == null
        ? t.joinedLateWait
        : mine.choiceIndex == null
          ? t.timesUp
          : mine.correct
            ? t.correctGain(mine.points)
            : t.wrong
    return (
      <section className="phone-wait reveal">
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
        <p className="place-line">{placeText(snapshot.players, you.playerId)}</p>
        {mine && <p className="hint">{paceHint(mine)}</p>}
      </section>
    )
  }

  return (
    <section className="phone-wait">
      <p className="eyebrow">{t.roundOver}</p>
      <h1>{placeText(snapshot.players, you.playerId)}</h1>
      <p className="score-line">
        {t.yourScore} <strong>{formatNumber(you.score)}</strong>
      </p>
      <p className="hint">{t.scoresOnTv}</p>
      <button type="button" className="btn ghost" onClick={() => leave(snapshot.code)}>
        {t.leave}
      </button>
    </section>
  )
}

function QuestionView({
  question,
  you,
  onError,
}: {
  question: PublicQuestion
  you: PlayerView
  onError: (message: string | null) => void
}) {
  const left = useCountdown(question.remainingMs, true)
  const [shown, setShown] = useState<number | null>(null)
  const [lockPending, setLockPending] = useState(false)
  const desired = useRef<number | null>(null)
  const sent = useRef<number | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const selection = shown ?? you.choiceIndex
  const fail = (err: unknown) => {
    if (!alive.current) return
    onError(errorText(errorCode(err)))
  }

  function onPick(index: number) {
    if (you.locked || lockPending) return
    setShown(index)
    desired.current = index
    onError(null)
    chain.current = chain.current
      .then(async () => {
        if (!alive.current || desired.current !== index || sent.current === index) return
        await request((ack) => socket.emit("player:choose", { choiceIndex: index }, ack))
        sent.current = index
      })
      .catch((err: unknown) => {
        if (alive.current) setShown(null)
        desired.current = sent.current
        fail(err)
      })
  }

  function onLock() {
    setLockPending(true)
    chain.current = chain.current
      .then(async () => {
        if (!alive.current) return
        await request((ack) => socket.emit("player:lock", ack))
      })
      .catch(fail)
      .finally(() => {
        if (alive.current) setLockPending(false)
      })
  }

  return (
    <section className="phone-play">
      <header className="phone-head">
        <span>{t.progress(question.index + 1, question.total)}</span>
        <TimerBar remainingMs={question.remainingMs} durationMs={question.durationMs} leftMs={left} />
        <span className={left <= 5000 ? "phone-secs urgent" : "phone-secs"}>
          {t.secsLeftShort(Math.ceil(left / 1000))}
        </span>
        <strong>{formatPoints(you.score)}</strong>
      </header>
      <AnswerGrid
        choices={question.choices}
        selected={selection}
        disabled={you.locked || lockPending}
        onPick={onPick}
      />
      <div className="lockbar">
        <p className="hint">{you.locked ? t.lockedIn : t.changeHint}</p>
        <button
          type="button"
          className="btn primary"
          disabled={you.locked || lockPending || selection == null}
          onClick={onLock}
        >
          {you.locked ? t.lockedIn : t.lockIn}
        </button>
      </div>
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

/** Lobby and final have their own Leave button; during a round it is a small one that asks twice. */
function inRound(phase: RoomSnapshot["phase"]): boolean {
  return phase === "ready" || phase === "question" || phase === "reveal"
}

function paceHint(result: RevealResult): string {
  if (result.choiceIndex == null || result.locked !== true || typeof result.elapsedMs !== "number") {
    return t.noLockPace
  }
  return t.lockedAt(result.elapsedMs)
}

function leave(code: string): void {
  const done = () => {
    forgetPlayer(local(), code)
    window.location.assign("/")
  }
  void request((ack) => socket.emit("player:leave", ack)).then(done, done)
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
  return chooseSession(local(), initialCode()) != null
}

function sessionOrNull(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
