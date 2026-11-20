import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { MAX_JOINS_PER_SOCKET, MAX_PLAYERS, type PlayerSession } from "../../shared/types.ts"
import { connect, createRoom, startTestWorker, type Client, type TestWorker } from "./harness.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settings = { questionDurationMs: 5_000, revealDurationMs: 2_000, autoAdvance: true, difficulty: "mixed" }

let worker: TestWorker
const opened: Client[] = []

before(async () => {
  worker = await startTestWorker()
})
after(async () => {
  for (const client of opened) client.close()
  await worker.dispose()
})

async function socket(code: string): Promise<Client> {
  const client = await connect(worker.url, code)
  opened.push(client)
  return client
}

async function ok<T = unknown>(client: Client, event: string, payload?: unknown): Promise<T> {
  const reply = await client.rpc(event, payload)
  assert.equal(reply.ok, true, `${event} failed: ${reply.error}`)
  return reply.data as T
}

async function newRoom(configure = true): Promise<{ code: string; host: Client }> {
  const { code, hostToken } = await createRoom(worker.url)
  const host = await socket(code)
  await ok(host, "host:attach", { code, hostToken })
  if (configure) await ok(host, "host:settings", settings)
  return { code, host }
}

async function join(code: string, name: string): Promise<{ client: Client; session: PlayerSession }> {
  const client = await socket(code)
  const session = await ok<PlayerSession>(client, "player:join", { code, name })
  return { client, session }
}

// Joins one player, starts, and has the player lock so the reveal comes at once.
async function toReveal(): Promise<{ code: string; host: Client }> {
  const { code, host } = await newRoom()
  const ala = await join(code, "Ala")
  await ok(host, "host:start")
  await ala.client.waitFor((s) => s.phase === "question")
  await ok(ala.client, "player:choose", { choiceIndex: 0 })
  await ok(ala.client, "player:lock")
  await host.waitFor((s) => s.phase === "reveal")
  return { code, host }
}

describe("room Durable Object over WebSockets", { timeout: 120_000 }, () => {
  it("plays a question: join, start, answer, lock, reveal", { timeout: 20_000 }, async () => {
    const { code, host } = await newRoom()
    const a = await join(code, "Ala")
    const b = await join(code, "Olek")
    await ok(host, "host:start")
    await a.client.waitFor((s) => s.phase === "question")
    await b.client.waitFor((s) => s.phase === "question")
    for (const player of [a, b]) {
      await ok(player.client, "player:choose", { choiceIndex: 1 })
      await ok(player.client, "player:lock")
    }
    const state = await host.waitFor((s) => s.phase === "reveal")
    assert.equal(state.players.length, 2)
    assert.ok(state.players.every((p) => typeof p.score === "number"))
    assert.equal(state.reveal?.counts.reduce((sum, n) => sum + n, 0), 2)
  })

  it("does not lose End sent right after Next", { timeout: 20_000 }, async () => {
    const { host } = await toReveal()
    const next = host.rpc("host:next")
    const end = host.rpc("host:end")
    await Promise.all([next, end])
    await host.waitFor((s) => s.phase === "finished")
    await sleep(4_000)
    assert.equal(host.state?.phase, "finished")
  })

  it("does not lose Pause sent right after Next", { timeout: 20_000 }, async () => {
    const { host } = await toReveal()
    const results = await Promise.all([host.rpc("host:pause"), host.rpc("host:next")])
    assert.equal(results[0]?.ok, true)
    assert.equal(results[1]?.ok, true)
    await host.waitFor((s) => s.phase === "ready")
  })

  it("deals one question for a double Next", { timeout: 20_000 }, async () => {
    const { host } = await toReveal()
    const [first, second] = await Promise.all([host.rpc("host:next"), host.rpc("host:next")])
    assert.equal(first?.ok, true)
    assert.equal(second?.ok, true)
    const ready = await host.waitFor((s) => s.phase === "ready")
    assert.equal(ready.ready?.index, 1)
    const question = await host.waitFor((s) => s.phase === "question")
    assert.equal(question.question?.index, 1)
  })

  it("moves on by alarm: timeout to reveal, then the next ready", { timeout: 25_000 }, async () => {
    const { code, host } = await newRoom()
    await join(code, "Ala")
    await ok(host, "host:start")
    const reveal = await host.waitFor((s) => s.phase === "reveal", 12_000)
    assert.equal(reveal.reveal?.results[0]?.choiceIndex, null)
    const ready = await host.waitFor((s) => s.phase === "ready", 8_000)
    assert.equal(ready.ready?.index, 1)
  })

  it("reattaches a player with the stored token", { timeout: 20_000 }, async () => {
    const { code, host } = await newRoom()
    const first = await join(code, "Ala")
    await ok(host, "host:start")
    await first.client.waitFor((s) => s.phase === "question")
    first.client.close()
    await host.waitFor((s) => s.players[0]?.connected === false)
    const again = await socket(code)
    const session = await ok<PlayerSession>(again, "player:attach", {
      code,
      playerId: first.session.playerId,
      token: first.session.token,
    })
    assert.equal(session.playerId, first.session.playerId)
    const state = await again.waitFor((s) => s.you.role === "player")
    assert.equal(state.you.role === "player" && state.you.score, 0)
  })

  it("lets a player join in the middle of a round with 0 points", { timeout: 20_000 }, async () => {
    const { code, host } = await newRoom()
    await join(code, "Ala")
    await ok(host, "host:start")
    await host.waitFor((s) => s.phase === "question")
    const late = await join(code, "Spóźniony")
    const state = await late.client.waitFor((s) => s.you.role === "player")
    assert.equal(state.phase, "question")
    assert.equal(state.you.role === "player" && state.you.score, 0)
  })

  it("removes a player on host:remove and shows the socket a guest view", { timeout: 20_000 }, async () => {
    const { code, host } = await newRoom()
    const ala = await join(code, "Ala")
    await join(code, "Olek")
    await ok(host, "host:remove", { playerId: ala.session.playerId })
    const state = await ala.client.waitFor((s) => s.you.role === "guest")
    assert.equal(state.players.length, 1)
    assert.equal(host.state?.players.length, 1)
  })

  it("removes a player on player:leave and ends the early wait", { timeout: 20_000 }, async () => {
    const { code, host } = await newRoom()
    const ala = await join(code, "Ala")
    const olek = await join(code, "Olek")
    await ok(host, "host:start")
    await host.waitFor((s) => s.phase === "question")
    await ok(olek.client, "player:choose", { choiceIndex: 0 })
    await ok(olek.client, "player:lock")
    // Ala never answers; when she leaves, everyone left has locked, so the question reveals at once.
    await ok(ala.client, "player:leave")
    const state = await host.waitFor((s) => s.phase === "reveal", 3_000)
    assert.equal(state.players.length, 1)
    // The leaving socket is a guest now and cannot act as a player.
    const reply = await ala.client.rpc("player:lock")
    assert.equal(reply.ok, false)
    assert.equal(reply.error, "join_first")
  })

  it("caps join attempts per socket", async () => {
    const { code } = await newRoom(false)
    const client = await socket(code)
    for (let i = 0; i < MAX_JOINS_PER_SOCKET; i++) {
      const reply = await client.rpc("player:join", { code, name: "" })
      assert.equal(reply.error, "name_empty")
    }
    const reply = await client.rpc("player:join", { code, name: "Ala" })
    assert.equal(reply.ok, false)
    assert.equal(reply.error, "too_many_joins")
  })

  it("caps the number of players in a room", { timeout: 40_000 }, async () => {
    const { code } = await newRoom(false)
    for (let i = 0; i < MAX_PLAYERS; i++) await join(code, `Gracz ${i}`)
    const extra = await socket(code)
    const reply = await extra.rpc("player:join", { code, name: "Gość 21" })
    assert.equal(reply.ok, false)
    assert.equal(reply.error, "room_full")
  })

  it("answers a bad percent escape in the path with 400", async () => {
    const res = await fetch(`${worker.url}/ws/%E0`)
    assert.equal(res.status, 400)
    const wrong = await fetch(`${worker.url}/ws/ABCDE`)
    assert.equal(wrong.status, 400)
  })

  it("rate limits room creation", async (t) => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      statuses.push((await fetch(`${worker.url}/api/rooms`, { method: "POST" })).status)
    }
    if (!statuses.includes(429)) {
      t.skip("local miniflare does not enforce ratelimits; test/http.test.ts covers the key")
      return
    }
    assert.ok(statuses.includes(429))
  })
})
