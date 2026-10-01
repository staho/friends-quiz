import { DurableObject } from "cloudflare:workers"
import schemaSql from "../migrations/0001_questions.sql"
import seedSql from "../migrations/0002_seed.sql"
import { pickRandomQuestion, type StatementDatabase } from "../server/catalog.ts"
import type { Question } from "../server/game.ts"
import { sqlStatements } from "../server/sql-script.ts"

export class CatalogDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      const existing = ctx.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'categories'")
        .toArray()
      if (existing.length > 0) return
      for (const statement of sqlStatements(schemaSql)) ctx.storage.sql.exec(statement)
      for (const statement of sqlStatements(seedSql)) ctx.storage.sql.exec(statement)
    })
  }

  async pickRandom(excludeIds: string[]): Promise<Question | null> {
    return pickRandomQuestion(sqliteDatabase(this.ctx.storage.sql), excludeIds)
  }
}

function sqliteDatabase(sql: SqlStorage): StatementDatabase {
  return {
    prepare(query: string) {
      const run = (...values: unknown[]) => ({
        async all<T>() {
          const results = sql.exec<Record<string, SqlStorageValue>>(query, ...values).toArray() as T[]
          return { results }
        },
      })
      return {
        bind(...values: unknown[]) {
          return run(...values)
        },
        all<T>() {
          return run().all<T>()
        },
      }
    },
  }
}
