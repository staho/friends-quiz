import type { Cue } from "./cues"

const MUTE_KEY = "friends-quiz-muted"
const MUTE_EVENT = "friends-quiz-mute"

type AudioCtor = typeof AudioContext

let ctx: AudioContext | null = null
let fallbackMuted = false

export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1"
  } catch {
    return fallbackMuted
  }
}

export function writeMuted(muted: boolean): void {
  fallbackMuted = muted
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0")
  } catch {
    // Private browsing can reject storage. The button still updates for this page.
  }
  window.dispatchEvent(new Event(MUTE_EVENT))
}

export function onMuteChange(listener: () => void): () => void {
  window.addEventListener(MUTE_EVENT, listener)
  window.addEventListener("storage", listener)
  return () => {
    window.removeEventListener(MUTE_EVENT, listener)
    window.removeEventListener("storage", listener)
  }
}

export function installSoundUnlock(): () => void {
  const arm = () => {
    const audio = context()
    if (audio?.state === "suspended") void audio.resume()
  }
  window.addEventListener("pointerdown", arm, true)
  window.addEventListener("keydown", arm, true)
  return () => {
    window.removeEventListener("pointerdown", arm, true)
    window.removeEventListener("keydown", arm, true)
  }
}

export function playCue(cue: Cue, delay = 0): void {
  if (readMuted()) return
  const audio = context()
  if (!audio) return
  const start = () => {
    if (readMuted() || audio.state !== "running") return
    play(audio, cue, delay)
  }
  if (audio.state === "suspended") {
    void audio.resume().then(start)
    return
  }
  start()
}

function context(): AudioContext | null {
  const ctor = audioCtor()
  if (!ctor) return null
  if (!ctx) ctx = new ctor()
  return ctx
}

function audioCtor(): AudioCtor | null {
  if (typeof AudioContext === "function") return AudioContext
  const legacy = (window as Window & { webkitAudioContext?: AudioCtor }).webkitAudioContext
  return typeof legacy === "function" ? legacy : null
}

interface Note {
  frequency: number
  offset: number
  duration: number
  type?: OscillatorType
  gain?: number
}

function play(audio: AudioContext, cue: Cue, delay: number): void {
  const when = audio.currentTime + delay
  if (cue === "lock") {
    click(audio, when)
    note(audio, { frequency: 180, offset: 0, duration: 0.08, type: "sine", gain: 0.08 }, when)
    return
  }
  for (const item of notes(cue)) note(audio, item, when)
}

function notes(cue: Exclude<Cue, "lock">): Note[] {
  switch (cue) {
    case "join":
      return [
        { frequency: 659, offset: 0, duration: 0.14, gain: 0.1 },
        { frequency: 880, offset: 0.09, duration: 0.2, gain: 0.1 },
      ]
    case "ready":
      return [{ frequency: 880, offset: 0, duration: 0.09, type: "sine", gain: 0.12 }]
    case "question":
      return [
        { frequency: 523, offset: 0, duration: 0.16, gain: 0.11 },
        { frequency: 659, offset: 0.1, duration: 0.16, gain: 0.11 },
        { frequency: 784, offset: 0.2, duration: 0.28, gain: 0.12 },
      ]
    case "tick":
      return [{ frequency: 1320, offset: 0, duration: 0.05, type: "square", gain: 0.04 }]
    case "allLocked":
      return [523, 659, 784].map((frequency) => ({
        frequency,
        offset: 0,
        duration: 0.32,
        gain: 0.06,
      }))
    case "reveal":
      return [
        { frequency: 784, offset: 0, duration: 0.18, gain: 0.12 },
        { frequency: 1046, offset: 0.12, duration: 0.36, gain: 0.12 },
      ]
    case "podium":
      return [
        { frequency: 523, offset: 0, duration: 0.16, gain: 0.11 },
        { frequency: 659, offset: 0.14, duration: 0.16, gain: 0.11 },
        { frequency: 784, offset: 0.28, duration: 0.16, gain: 0.11 },
        { frequency: 1046, offset: 0.42, duration: 0.5, gain: 0.12 },
      ]
    case "pick":
      return [{ frequency: 740, offset: 0, duration: 0.06, gain: 0.06 }]
    case "correct":
      return [
        { frequency: 880, offset: 0, duration: 0.16, gain: 0.1 },
        { frequency: 1175, offset: 0.08, duration: 0.28, gain: 0.1 },
      ]
    case "miss":
      return [
        { frequency: 349, offset: 0, duration: 0.16, type: "triangle", gain: 0.08 },
        { frequency: 277, offset: 0.1, duration: 0.24, type: "triangle", gain: 0.07 },
      ]
    case "timeup":
      return [{ frequency: 220, offset: 0, duration: 0.28, type: "sine", gain: 0.06 }]
  }
}

function note(audio: AudioContext, item: Note, when: number): void {
  const osc = audio.createOscillator()
  const amp = audio.createGain()
  const start = when + item.offset
  const peak = item.gain ?? 0.1
  osc.type = item.type ?? "sine"
  osc.frequency.setValueAtTime(item.frequency, start)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.02, item.duration / 3))
  amp.gain.exponentialRampToValueAtTime(0.0001, start + item.duration)
  osc.connect(amp)
  amp.connect(audio.destination)
  osc.start(start)
  osc.stop(start + item.duration + 0.02)
}

function click(audio: AudioContext, when: number): void {
  const length = Math.max(1, Math.floor(audio.sampleRate * 0.025))
  const buffer = audio.createBuffer(1, length, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length)
  }
  const source = audio.createBufferSource()
  const amp = audio.createGain()
  source.buffer = buffer
  amp.gain.setValueAtTime(0.2, when)
  amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.03)
  source.connect(amp)
  amp.connect(audio.destination)
  source.start(when)
  source.stop(when + 0.04)
}
