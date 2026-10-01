import { execFileSync } from "node:child_process"

const name = "friends-quiz"

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  })
}

try {
  console.log(wrangler(["d1", "create", name]))
} catch (error) {
  const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`
  if (/already exists/i.test(output)) {
    console.log(`D1 database ${name} already exists`)
  } else {
    console.error(output)
    if (/10000/.test(output)) {
      console.error(
        "The Cloudflare API token cannot manage D1. Add the Account permission D1 Edit to CLOUDFLARE_API_TOKEN, then rerun Deploy.",
      )
    }
    process.exit(error.status ?? 1)
  }
}
