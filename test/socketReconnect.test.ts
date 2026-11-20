import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

type Listener = (event: { data?: unknown }) => void

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static all: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  private listeners = new Map<string, Listener[]>()
  constructor(readonly url: string) {
    FakeWebSocket.all.push(this)
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  private fire(type: string, event: { data?: unknown } = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event)
  }
  send(data: string): void {
    this.sent.push(data)
    if (data === "ping") return
    const message = JSON.parse(data) as { id: string }
    queueMicrotask(() => this.fire("message", { data: JSON.stringify({ id: message.id, ok: true, data: {} }) }))
  }
  /** close() does not fire the event: browsers deliver it late, or never, while offline. */
  close(): void {
    if (this.readyState !== 3) this.readyState = 2
  }
  open(): void {
    this.readyState = 1
    this.fire("open")
  }
  deliverClose(): void {
    this.readyState = 3
    this.fire("close")
  }
  attaches(): number {
    return this.sent.filter((s) => s.includes('"player:attach"')).length
  }
}

const windowListeners = new Map<string, Array<() => void>>()
const documentListeners = new Map<string, Array<() => void>>()
const doc = {
  visibilityState: "visible",
  addEventListener: (type: string, fn: () => void) => documentListeners.set(type, [...(documentListeners.get(type) ?? []), fn]),
}
const win = {
  location: { protocol: "http:", host: "x.test" },
  addEventListener: (type: string, fn: () => void) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id),
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id: number) => clearInterval(id),
}
Object.assign(globalThis, { WebSocket: FakeWebSocket, window: win, document: doc })
const { QuizSocket } = await import("../client/src/socket.ts")

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

async function setup() {
  const s = new QuizSocket()
  const log: string[] = []
  s.on("connect", () => {
    log.push("connect")
    s.emit("player:attach", { code: "ABCD", playerId: "p1", token: "t" }, () => undefined)
  })
  s.on("disconnect", () => log.push("disconnect"))
  s.emit("player:attach", { code: "ABCD", playerId: "p1", token: "t" }, () => undefined)
  const first = FakeWebSocket.all[0]
  first.open()
  await flush()
  assert.equal(first.attaches(), 1)
  return { s, log, first }
}

const wakeOnline = () => windowListeners.get("online")?.forEach((fn) => fn())
const wakeVisible = () => documentListeners.get("visibilitychange")?.forEach((fn) => fn())

function assertRecovered(s: { connected: boolean }, log: string[], dead: FakeWebSocket[]) {
  const newest = FakeWebSocket.all[FakeWebSocket.all.length - 1]
  assert.equal(s.connected, true)
  assert.ok(!dead.includes(newest))
  assert.equal(newest.attaches(), 1, "exactly one attach on the newest socket")
  for (const old of dead) assert.equal(old.attaches() <= 1, true)
  assert.deepEqual(log, ["disconnect", "connect"])
}

describe("QuizSocket socket replacement", () => {
  beforeEach(() => {
    FakeWebSocket.all = []
    windowListeners.clear()
    documentListeners.clear()
    doc.visibilityState = "visible"
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
  })
  afterEach(() => mock.timers.reset())

  it("heartbeat timeout with a delayed close, then online", async () => {
    const { s, log, first } = await setup()
    mock.timers.tick(20000)
    mock.timers.tick(8000)
    assert.equal(s.connected, false)
    wakeOnline()
    const second = FakeWebSocket.all[1]
    second.open()
    await flush()
    first.deliverClose()
    await flush()
    assertRecovered(s, log, [first])
  })

  it("close arriving after the replacement socket opened", async () => {
    const { s, log, first } = await setup()
    wakeOnline()
    FakeWebSocket.all[1].open()
    await flush()
    first.deliverClose()
    await flush()
    assertRecovered(s, log, [first])
    assert.equal(FakeWebSocket.all.length, 2)
  })

  it("offline then online with no close event at all", async () => {
    const { s, log, first } = await setup()
    mock.timers.tick(40000)
    wakeOnline()
    FakeWebSocket.all[1].open()
    await flush()
    assertRecovered(s, log, [first])
  })

  it("visibility wake-up with a dead socket", async () => {
    const { s, log, first } = await setup()
    wakeVisible()
    mock.timers.tick(8000)
    assert.equal(s.connected, false)
    mock.timers.tick(12000)
    FakeWebSocket.all[1].open()
    await flush()
    assertRecovered(s, log, [first])
  })

  it("server-initiated close", async () => {
    const { s, log, first } = await setup()
    first.deliverClose()
    assert.equal(s.connected, false)
    mock.timers.tick(12000)
    FakeWebSocket.all[1].open()
    await flush()
    assertRecovered(s, log, [first])
  })

  it("join_first on a request replaces the socket so the screen re-attaches", async () => {
    const { s, log, first } = await setup()
    first.send = function (this: FakeWebSocket, data: string) {
      this.sent.push(data)
      const id = (JSON.parse(data) as { id: string }).id
      queueMicrotask(() => (this as unknown as { fire(t: string, e: object): void }).fire("message", { data: JSON.stringify({ id, ok: false, error: "join_first" }) }))
    }
    let result: unknown
    s.emit("player:choose", { choiceIndex: 1 }, (res) => (result = res))
    await flush()
    assert.deepEqual(result, { ok: false, error: "reconnecting" })
    FakeWebSocket.all[1].open()
    await flush()
    assertRecovered(s, log, [first])
  })
})
