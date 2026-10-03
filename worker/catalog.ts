import { DurableObject } from "cloudflare:workers"
import schemaSql from "../migrations/0001_questions.sql"
import seedSql from "../migrations/0002_seed.sql"
import statsSql from "../migrations/0003_question_stats.sql"
import categoriesSql from "../migrations/0004_categories.sql"
import geographySql from "../migrations/0005_geography.sql"
import scienceSql from "../migrations/0006_science.sql"
import commonSql from "../migrations/0007_common.sql"
import moviesSql from "../migrations/0008_movies.sql"
import historySql from "../migrations/0009_history.sql"
import {
  applyCatalogMigrations,
  pickRandomQuestion,
  recordQuestionPlay,
  type CatalogMigration,
  type MigrationDatabase,
  type QuestionPlay,
  type StatementDatabase,
} from "../server/catalog.ts"
import type { Question } from "../server/game.ts"

const MIGRATIONS: CatalogMigration[] = [
  { name: "0001_questions.sql", sql: schemaSql },
  { name: "0002_seed.sql", sql: seedSql },
  { name: "0003_question_stats.sql", sql: statsSql },
  { name: "0004_categories.sql", sql: categoriesSql },
  { name: "0005_geography.sql", sql: geographySql },
  { name: "0006_science.sql", sql: scienceSql },
  { name: "0007_common.sql", sql: commonSql },
  { name: "0008_movies.sql", sql: moviesSql },
  { name: "0009_history.sql", sql: historySql },
]

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
