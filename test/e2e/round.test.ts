// One full round in a real browser: a TV and two phones, each phone in its own browser context
// because contexts would otherwise share localStorage. Needs `npm run build` first (test:e2e does it).
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { after, before, describe, it } from "node:test"
import { chromium, type Browser, type Page } from "playwright-core"
import { startTestWorker, uniqueClientIp, type TestWorker } from "../worker/harness.ts"

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist")

let worker: TestWorker
let browser: Browser

before(async () => {
  worker = await startTestWorker({ assetsDir: dist })
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome" })
})
after(async () => {
  await browser?.close()
  await worker?.dispose()
})

async function phone(name: string, code: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(`${worker.url}/`)
  await page.fill('input[name="quiz-room-code"]', code)
  await page.fill('input[name="quiz-player-name"]', name)
  await page.getByRole("button", { name: "Dołącz", exact: true }).click()
  await page.getByText("Jesteś w grze").waitFor()
  return page
}

async function standings(tv: Page): Promise<string[]> {
  return tv.locator(".standings > li").evaluateAll((rows) =>
    rows.map((row) => `${row.querySelector(".st-name")?.textContent}=${row.querySelector(".st-score")?.textContent}`),
  )
}

describe("a round in the browser", { timeout: 120_000 }, () => {
  it("plays two phones through one question, a TV refresh and the podium", async () => {
    const tvContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: { "CF-Connecting-IP": uniqueClientIp() },
    })
    const tv = await tvContext.newPage()
    await tv.goto(`${worker.url}/host`)
    await tv.locator(".code").waitFor()
    const label = await tv.locator(".code").getAttribute("aria-label")
    const code = /[A-Z]{4}/.exec(label ?? "")?.[0]
    assert.ok(code, `room code in "${label}"`)

    const ala = await phone("Ala", code)
    const olek = await phone("Olek", code)
    await tv.locator(".chips li.chip").nth(1).waitFor()

    await tv.keyboard.press("Enter")
    for (const page of [ala, olek]) {
      await page.locator(".answer-grid.phone button").first().click()
      await page.getByRole("button", { name: "Zatwierdź", exact: true }).click()
    }

    await tv.locator(".board.reveal").waitFor()
    await tv.keyboard.press("Space")
    await tv.getByText(/^Pauza · zostało/).waitFor()
    await tv.locator(".standings > li").nth(1).waitFor()
    assert.equal(await tv.locator(".standings > li").count(), 2)
    const scores = await standings(tv)

    // 1.2: a new TV page in the same browser context comes back to the same room and scores.
    await tv.close()
    const again = await tvContext.newPage()
    await again.goto(`${worker.url}/host`)
    await again.locator(".standings > li").nth(1).waitFor()
    assert.deepEqual(await standings(again), scores)

    await again.getByRole("button", { name: "Zakończ", exact: true }).click()
    await again.getByRole("button", { name: "Naciśnij jeszcze raz, żeby zakończyć" }).click()
    await again.locator(".board.final").waitFor()
    // The correct answer is shuffled and the phones pick blind, so both can score 0. Then the
    // podium has nobody to show and the two names sit in the list instead.
    if (scores.some((row) => !row.endsWith("=0"))) {
      await again.locator(".podium .step").first().waitFor()
    } else {
      assert.equal(await again.locator(".standings > li").count(), 2)
    }
    await ala.getByText("Koniec rundy").waitFor()
  })

  it("leaves a round with two taps, and the TV shows the player gone and then drops them", async () => {
    const tvContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: { "CF-Connecting-IP": uniqueClientIp() },
    })
    const tv = await tvContext.newPage()
    await tv.goto(`${worker.url}/host`)
    await tv.locator(".code").waitFor()
    const label = await tv.locator(".code").getAttribute("aria-label")
    const code = /[A-Z]{4}/.exec(label ?? "")?.[0]
    assert.ok(code, `room code in "${label}"`)

    const ala = await phone("Ala", code)
    const olek = await phone("Olek", code)
    await tv.locator(".chips li.chip").nth(1).waitFor()
    await tv.keyboard.press("Enter")
    await ala.locator(".answer-grid.phone button").first().waitFor()

    // One tap only arms it: Ala is still in the question.
    await ala.getByRole("button", { name: "Wyjdź", exact: true }).click()
    await ala.getByRole("button", { name: "Na pewno wyjść?" }).waitFor()
    assert.equal(await ala.locator(".answer-grid.phone button").count(), 4)
    // Tapping an answer disarms it again.
    await ala.locator(".answer-grid.phone button").first().click()
    await ala.getByRole("button", { name: "Wyjdź", exact: true }).waitFor()

    await ala.getByRole("button", { name: "Wyjdź", exact: true }).click()
    await ala.getByRole("button", { name: "Na pewno wyjść?" }).click()
    await ala.locator("form.join").waitFor()

    // Olek is the only player left, so locking him in reveals the question; Ala shows as gone.
    await olek.locator(".answer-grid.phone button").first().click()
    await olek.getByRole("button", { name: "Zatwierdź", exact: true }).click()
    await tv.locator(".board.reveal").waitFor()
    const rows = await tv.locator(".standings > li").allTextContents()
    assert.equal(rows.length, 2)
    assert.ok(rows.some((row) => row.includes("Ala") && row.includes("wyszedł")), rows.join(" | "))
    assert.ok(!rows.some((row) => row.includes("brak odpowiedzi")))

    // The round ends: she is gone from the roster.
    await tv.getByRole("button", { name: "Zakończ", exact: true }).click()
    await tv.getByRole("button", { name: "Naciśnij jeszcze raz, żeby zakończyć" }).click()
    await tv.locator(".board.final").waitFor()
    assert.ok(!(await tv.locator(".board.final").textContent())?.includes("Ala"))
    await tvContext.close()
  })
})
