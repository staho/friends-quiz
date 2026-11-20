import { useEffect, useState } from "react"
import type { HostSession, RoomSettings, RoomSnapshot } from "@shared/types"
import { MuteButton } from "../MuteButton"
import { request, socket } from "../socket"
import { useRoom } from "../useRoom"
import { errorCode, errorText } from "../errors"
import { decideAfterAttachFailure, forgetHost, migrateLegacyHost, pruneHosts, readLastHost, retryDelayMs, saveHost } from "../hostSession"
import { local } from "../storage"
import { t } from "../strings"
import { useHostSounds } from "../useSounds"
import { FinalBoard } from "./host/FinalBoard"
import { LobbyBoard } from "./host/LobbyBoard"
import { QuestionBoard } from "./host/QuestionBoard"
import { ReadyBoard } from "./host/ReadyBoard"
import { RevealBoard } from "./host/RevealBoard"
import { ConfirmButton } from "./host/ConfirmButton"
import { useHostKeys } from "./host/useHostKeys"

let hostAttempt: Promise<void> | null = null

export function HostScreen() {
  const { snapshot, connected } = useRoom()
  const [error, setError] = useState<string | null>(null)
  const [bindError, setBindError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    let timer = 0
    let attempt = 0
    const boot = () => {
      window.clearTimeout(timer)
      attempt = 0
      const go = () => {
        openOrAttach(false).then(
          () => {
            if (alive) setBindError(null)
          },
          (err: unknown) => {
            if (!alive) return
            setBindError(readLastHost(local()) ? t.hostReconnecting : errorText(errorCode(err)))
            timer = window.setTimeout(go, retryDelayMs(attempt++))
          },
        )
      }
      go()
    }
    socket.on("connect", boot)
    if (socket.connected) boot()
    return () => {
      alive = false
      window.clearTimeout(timer)
      socket.off("connect", boot)
    }
  }, [])

  useHostKeys({
    snapshot,
    busy,
    onStart: () => void run(() => request((ack) => socket.emit("host:start", ack))),
    onNext: () => void run(() => request((ack) => socket.emit("host:next", ack))),
    onPause: () => void run(() => request((ack) => socket.emit("host:pause", ack))),
  })

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.tryAgain)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="stage tv">
      <HostSoundTrack snapshot={snapshot} />
      <div className="stage-bar">
        <p className="eyebrow">{t.appName}</p>
        <div className="stage-tools">
          <ConfirmButton
            label={t.newRoom}
            confirmLabel={t.newRoomConfirm}
            disabled={busy}
            onConfirm={() => void run(() => openOrAttach(true))}
          />
          <MuteButton />
          <FullScreenToggle />
        </div>
      </div>
      {!connected && <p className="banner">{t.reconnecting}</p>}
      {bindError && <p className="banner">{bindError}</p>}
      {error && <p className="banner">{error}</p>}
      {!snapshot ? (
        <p className="waiting">{t.settingUp}</p>
      ) : (
        <HostBody
          snapshot={snapshot}
          busy={busy}
          onStart={() => run(() => request((ack) => socket.emit("host:start", ack)))}
          onNext={() => run(() => request((ack) => socket.emit("host:next", ack)))}
          onPause={() => run(() => request((ack) => socket.emit("host:pause", ack)))}
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
  onPause,
  onEnd,
  onReset,
  onSettings,
}: {
  snapshot: RoomSnapshot
  busy: boolean
  onStart: () => void
  onNext: () => void
  onPause: () => void
  onEnd: () => void
  onReset: () => void
  onSettings: (settings: RoomSettings) => void
}) {
  if (snapshot.phase === "lobby") {
    return <LobbyBoard snapshot={snapshot} busy={busy} onStart={onStart} onSettings={onSettings} />
  }

  if (snapshot.phase === "ready" && snapshot.ready) {
    return <ReadyBoard snapshot={snapshot} busy={busy} onEnd={onEnd} onSettings={onSettings} />
  }

  if (snapshot.phase === "question" && snapshot.question) {
    return <QuestionBoard snapshot={snapshot} busy={busy} onEnd={onEnd} onSettings={onSettings} />
  }

  if (snapshot.phase === "reveal" && snapshot.reveal) {
    return (
      <RevealBoard
        snapshot={snapshot}
        busy={busy}
        onNext={onNext}
        onPause={onPause}
        onEnd={onEnd}
        onSettings={onSettings}
      />
    )
  }

  return <FinalBoard snapshot={snapshot} busy={busy} onReset={onReset} onSettings={onSettings} />
}

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void
}

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => void
}

function currentFullscreen(): Element | null {
  const doc = document as WebkitDocument
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

async function enterFullscreen(): Promise<void> {
  const root = document.documentElement as WebkitElement
  if (typeof root.requestFullscreen === "function") {
    await root.requestFullscreen()
    return
  }
  if (typeof root.webkitRequestFullscreen === "function") {
    root.webkitRequestFullscreen()
    return
  }
  throw new Error("unavailable")
}

async function leaveFullscreen(): Promise<void> {
  const doc = document as WebkitDocument
  if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
    await document.exitFullscreen()
    return
  }
  if (typeof doc.webkitExitFullscreen === "function") {
    doc.webkitExitFullscreen()
    return
  }
  throw new Error("unavailable")
}

function FullScreenToggle() {
  const [active, setActive] = useState(() => currentFullscreen() != null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const sync = () => {
      const on = currentFullscreen() != null
      setActive(on)
      if (on) setUnavailable(false)
    }
    document.addEventListener("fullscreenchange", sync)
    document.addEventListener("webkitfullscreenchange", sync)
    return () => {
      document.removeEventListener("fullscreenchange", sync)
      document.removeEventListener("webkitfullscreenchange", sync)
    }
  }, [])

  async function toggle() {
    setUnavailable(false)
    try {
      if (currentFullscreen()) await leaveFullscreen()
      else await enterFullscreen()
    } catch {
      setUnavailable(true)
    }
  }

  return (
    <div className="fullscreen-control">
      <button
        type="button"
        className="btn ghost fullscreen-btn"
        aria-pressed={active}
        onClick={() => void toggle()}
      >
        {active ? t.exitFullScreen : t.fullScreen}
      </button>
      {unavailable && <p className="fullscreen-hint">{t.fullScreenUnavailable}</p>}
    </div>
  )
}

function HostSoundTrack({ snapshot }: { snapshot: RoomSnapshot | null }) {
  useHostSounds(snapshot)
  return null
}

async function openOrAttach(forceNew: boolean): Promise<void> {
  if (hostAttempt) {
    const running = hostAttempt
    if (!forceNew) return running
    await running.catch(() => undefined)
  }
  hostAttempt = bindHost(forceNew).finally(() => {
    hostAttempt = null
  })
  return hostAttempt
}

async function bindHost(forceNew: boolean): Promise<void> {
  const store = local()
  migrateLegacyHost(store, sessionOrNull())
  pruneHosts(store, Date.now())
  const saved = forceNew ? null : readLastHost(store)
  if (saved) {
    try {
      await request<HostSession>((ack) => socket.emit("host:attach", { code: saved.code, hostToken: saved.hostToken }, ack))
      saveHost(store, saved, Date.now())
      return
    } catch (err) {
      const code = errorCode(err)
      if (decideAfterAttachFailure(code) === "retry") throw err
      forgetHost(store, saved.code)
    }
  }
  const session = await request<HostSession>((ack) => socket.emit("host:create", ack))
  saveHost(store, session, Date.now())
}

function sessionOrNull(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
