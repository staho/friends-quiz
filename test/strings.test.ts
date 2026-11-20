import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it } from "node:test"
import { formatNumber, formatPoints, formatSeconds, fmt, NBSP, plural, t } from "../client/src/strings.ts"

describe("plural", () => {
  const form = (n: number) => plural(n, "one", "few", "many")
  it("uses the three Polish forms", () => {
    for (const n of [1]) assert.equal(form(n), "one", String(n))
    for (const n of [2, 4, 22]) assert.equal(form(n), "few", String(n))
    for (const n of [0, 5, 12, 14, 21, 25, 112]) assert.equal(form(n), "many", String(n))
  })
})

describe("number formatting", () => {
  it("groups thousands with a no-break space", () => {
    assert.equal(formatNumber(950), "950")
    assert.equal(formatNumber(3450), `3${NBSP}450`)
    assert.equal(formatNumber(12345), `12${NBSP}345`)
    assert.equal(formatNumber(-3450), `-3${NBSP}450`)
  })

  it("formats seconds with a decimal comma", () => {
    assert.equal(formatSeconds(1700), `1,7${NBSP}s`)
    assert.equal(formatSeconds(0), `0,0${NBSP}s`)
    assert.equal(formatSeconds(12000), `12${NBSP}s`)
  })

  it("formats points and fills templates", () => {
    assert.equal(formatPoints(4350), `4${NBSP}350${NBSP}pkt`)
    assert.equal(fmt("a {x} {y}", { x: 1 }), "a 1 {y}")
  })
})

describe("t", () => {
  it("holds only non-empty strings and functions", () => {
    for (const [key, value] of Object.entries(t)) {
      if (typeof value === "function") continue
      assert.equal(typeof value, "string", key)
      assert.ok((value as string).length > 0, key)
    }
  })

  it("builds places, plurals and lock times", () => {
    assert.equal(t.place(21), "21. miejsce")
    assert.equal(t.finalLine(2, 4350), `2. miejsce · 4${NBSP}350${NBSP}pkt`)
    assert.equal(t.secondsLeft(1), "Została 1 sekunda")
    assert.equal(t.secondsLeft(3), "Zostały 3 sekundy")
    assert.equal(t.secondsLeft(5), "Zostało 5 sekund")
    assert.equal(t.secondsUnit(null), "s")
    assert.equal(t.lockedAt(4200), `Zatwierdzone po 4,2${NBSP}s.`)
    assert.equal(t.players(22), "22 gracze")
    assert.equal(t.points(12), `12 punktów`)
  })
})

const ALLOWED_TEXT = new Set<string>([])
const LETTERS = /[A-Za-z]{2,}/

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** English-looking literals in a tsx source: JSX text nodes and text-bearing attributes. */
export function findLiterals(source: string): string[] {
  const code = stripComments(source)
    .replace(/\breturn\s+</g, "(<").replace(/^import[\s\S]*?from\s+["'][^"']+["']/gm, "")
  const found: string[] = []
  const text = /(?:(?<![=-])>([^<>{}()=;]*)[<{]|\}([^<>{}()=;\n]*)<)/g
  for (const match of code.matchAll(text)) {
    const value = (match[1] ?? match[2] ?? "").trim()
    if (LETTERS.test(value) && !ALLOWED_TEXT.has(value)) found.push(value)
  }
  const attr = /\b(?:aria-label|aria-description|title|placeholder|alt|label|hint)=(?:"([^"]*)"|\{\s*["'`]([^"'`]*))/g
  for (const match of code.matchAll(attr)) {
    const value = match[1] ?? match[2] ?? ""
    if (LETTERS.test(value) && !ALLOWED_TEXT.has(value)) found.push(value)
  }
  return found
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return tsxFiles(path)
    return path.endsWith(".tsx") ? [path] : []
  })
}

describe("no English left in the client", () => {
  it("finds literals in a sample", () => {
    assert.deepEqual(findLiterals(`<p>Hello there</p>`), ["Hello there"])
    assert.deepEqual(findLiterals(`<b aria-label="Close it" />`), ["Close it"])
    assert.deepEqual(findLiterals("<b title={`Go ${x}`} />"), ["Go ${x}"])
    assert.deepEqual(findLiterals(`<p>{t.ok}</p><span>A</span><i>{x} B</i>`), [])
  })

  it("keeps every tsx file free of literal UI text", () => {
    const root = join(import.meta.dirname, "..", "client", "src")
    for (const file of tsxFiles(root)) {
      const left = findLiterals(readFileSync(file, "utf8"))
      assert.deepEqual(left, [], `${relative(root, file)} has literal text`)
    }
  })
})
