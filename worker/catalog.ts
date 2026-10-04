import { DurableObject } from "cloudflare:workers"
import {
  applyCatalogMigrations,
  pickRandomQuestion,
  recordQuestionPlay,
  type MigrationDatabase,
  type QuestionPlay,
  type StatementDatabase,
} from "../server/catalog.ts"
import type { Question } from "../server/game.ts"
import { MIGRATIONS } from "./catalog-migrations.ts"

export class CatalogDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      applyCatalogMigrations(migrationDatabase(ctx.storage.sql), MIGRATIONS)
    })
  }

  async pickRandom(
    excludeIds: string[],
    difficulty?: number,
    bounds?: { minDifficulty: number; maxDifficulty: number },
  ): Promise<Question | null> {
    return pickRandomQuestion(sqliteDatabase(this.ctx.storage.sql), excludeIds, difficulty, bounds)
  }

  async recordPlay(play: QuestionPlay): Promise<boolean> {
    return recordQuestionPlay(sqliteDatabase(this.ctx.storage.sql), play)
  }
}

function migrationDatabase(sql: SqlStorage): MigrationDatabase {
  return {
    exec(query: string) {
      sql.exec(query)
    },
    all<T>(query: string, ...values: unknown[]): T[] {
      return sql.exec<Record<string, SqlStorageValue>>(query, ...values).toArray() as T[]
    },
    run(query: string, ...values: unknown[]) {
      sql.exec(query, ...values)
    },
  }
}

function sqliteDatabase(sql: SqlStorage): StatementDatabase {
  return {
    prepare(query: string) {
      const statement = (...values: unknown[]) => ({
        bind(...next: unknown[]) {
          return statement(...next)
        },
        async all<T>() {
          const results = sql.exec<Record<string, SqlStorageValue>>(query, ...values).toArray() as T[]
          return { results }
        },
        async run() {
          sql.exec(query, ...values)
          const rows = sql.exec<{ changes: number }>("SELECT changes() AS changes").toArray()
          return { changes: Number(rows[0]?.changes ?? 0) }
        },
      })
      return statement()
    },
  }
}
