import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const name = "friends-quiz"
const configPath = "wrangler.jsonc"

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  })
}

function databaseIdFromList(raw) {
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start === -1 || end < start) throw new Error("Could not read the D1 database list")
  const parsed = JSON.parse(raw.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error("Could not read the D1 database list")
  const found = parsed.find((row) => row.name === name)
  return found?.uuid ?? found?.database_id ?? null
}

let id = databaseIdFromList(wrangler(["d1", "list", "--json"]))

if (!id) {
  const created = wrangler(["d1", "create", name, "--binding", "DB"])
  const match = created.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  if (!match) throw new Error("Could not read the new D1 database id")
  id = match[0]
}

const config = readFileSync(configPath, "utf8")
const updated = config.replace(
  /("database_name"\s*:\s*"friends-quiz"[\s\S]*?"database_id"\s*:\s*")[^"]+(")/,
  `$1${id}$2`,
)
if (!updated.includes(id)) throw new Error("Could not write the D1 database id into wrangler.jsonc")
writeFileSync(configPath, updated)
console.log(`D1 ${name} ${id}`)
