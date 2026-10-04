import { useEffect, useState } from "react"
import type { HostSession, RoomSettings, RoomSnapshot } from "@shared/types"
import { MuteButton } from "../MuteButton"
import { request, socket } from "../socket"
import { useRoom } from "../useRoom"
import { useHostSounds } from "../useSounds"
import { FinalBoard } from "./host/FinalBoard"
import { LobbyBoard } from "./host/LobbyBoard"
import { QuestionBoard } from "./host/QuestionBoard"
import { ReadyBoard } from "./host/ReadyBoard"
import { RevealBoard } from "./host/RevealBoard"

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
      <HostSoundTrack snapshot={snapshot} />
      <div className="stage-bar">
        <p className="eyebrow">Friends quiz</p>
        <div className="stage-tools">
          <MuteButton />
          <FullScreenToggle />
        </div>
      </div>
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
        {active ? "Exit full screen" : "Full screen"}
      </button>
      {unavailable && <p className="fullscreen-hint">Full screen isn't available in this browser</p>}
    </div>
  )
}

function HostSoundTrack({ snapshot }: { snapshot: RoomSnapshot | null }) {
  useHostSounds(snapshot)
  return null
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
