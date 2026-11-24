import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  validateRateLimitOptions,
  type RateLimitDecision,
  type RateLimitOptions,
  type RateLimitTable,
  type RateLimitUsage,
} from "../contract.js";
import type { ResourcesDatabase, ResourcesTransaction } from "./db.js";
import * as schema from "./schema.js";

export interface PostgresRateLimitTableOptions {
  readonly pool: Pool;
  readonly tableKey: string;
  readonly rateLimit: RateLimitOptions;
}

interface GlobalRow {
  readonly windowStartedAt: number;
  readonly count: number;
  readonly bytes: number;
  readonly entries: number;
  readonly entryBytes: number;
}

const SWEEP_BATCH_SIZE = 100;

function retryAfterMs(windowStartedAt: number, windowMs: number, now: number): number {
  return Math.max(0, windowStartedAt + windowMs - now);
}

function entrySize(key: string, overheadBytes: number): number {
  return overheadBytes + Buffer.byteLength(key, "utf8");
}

export class PostgresRateLimitTable implements RateLimitTable {
  private readonly db: ResourcesDatabase;
  private readonly tableKey: string;
  private readonly options: RateLimitOptions;

  public constructor(options: PostgresRateLimitTableOptions) {
    validateRateLimitOptions(options.rateLimit);
    if (options.tableKey.length === 0) {
      throw new Error("tableKey must not be empty");
    }
    this.db = drizzle(options.pool, { schema });
    this.tableKey = options.tableKey;
    this.options = options.rateLimit;
  }

  public async consume(key: string, costBytes: number, now: number): Promise<RateLimitDecision> {
    if (key.length === 0 || !Number.isSafeInteger(costBytes) || costBytes < 0) {
      return { allowed: false, reason: "invalid-request" };
    }
    if (costBytes > this.options.maxBytesPerKey) {
      return { allowed: false, reason: "bandwidth-limit" };
    }

    return this.db.transaction(async (tx) => {
      const global = await this.lockGlobal(tx, now);
      const resetGlobal = await this.resetGlobalIfExpired(tx, global, now);
      if (
        resetGlobal.count + 1 > this.options.maxRequestsGlobal ||
        resetGlobal.bytes + costBytes > this.options.maxBytesGlobal
      ) {
        return {
          allowed: false,
          reason:
            resetGlobal.count + 1 > this.options.maxRequestsGlobal
              ? "request-limit"
              : "bandwidth-limit",
          retryAfterMs: retryAfterMs(resetGlobal.windowStartedAt, this.options.windowMs, now),
        };
      }

      let entry = await this.lockEntry(tx, key);
      if (entry === undefined) {
        const sizeBytes = entrySize(key, this.options.entryOverheadBytes);
        let capacity = {
          entries: resetGlobal.entries,
          entryBytes: resetGlobal.entryBytes,
        };
        if (
          capacity.entries >= this.options.maxEntries ||
          capacity.entryBytes + sizeBytes > this.options.maxBytes
        ) {
          capacity = await this.sweepExpiredBatch(tx, now);
        }
        if (capacity.entries >= this.options.maxEntries) {
          return { allowed: false, reason: "entry-limit" };
        }
        if (capacity.entryBytes + sizeBytes > this.options.maxBytes) {
          return { allowed: false, reason: "byte-limit" };
        }
        await tx.insert(schema.rateLimitEntry).values({
          tableKey: this.tableKey,
          entryKey: key,
          windowStartedAt: now,
          count: 0,
          bytes: 0,
          lastUsedAt: now,
          sizeBytes,
        });
        await tx
          .update(schema.rateLimitGlobal)
          .set({
            entries: capacity.entries + 1,
            entryBytes: capacity.entryBytes + sizeBytes,
          })
          .where(eq(schema.rateLimitGlobal.tableKey, this.tableKey));
        entry = {
          tableKey: this.tableKey,
          entryKey: key,
          windowStartedAt: now,
          count: 0,
          bytes: 0,
          lastUsedAt: now,
          sizeBytes,
        };
      } else if (now >= entry.windowStartedAt + this.options.windowMs) {
        entry = {
          ...entry,
          windowStartedAt: now,
          count: 0,
          bytes: 0,
        };
      }

      if (
        entry.count + 1 > this.options.maxRequestsPerKey ||
        entry.bytes + costBytes > this.options.maxBytesPerKey
      ) {
        await this.updateEntry(tx, { ...entry, lastUsedAt: now });
        return {
          allowed: false,
          reason:
            entry.count + 1 > this.options.maxRequestsPerKey ? "request-limit" : "bandwidth-limit",
          retryAfterMs: retryAfterMs(entry.windowStartedAt, this.options.windowMs, now),
        };
      }

      await this.updateEntry(tx, {
        ...entry,
        count: entry.count + 1,
        bytes: entry.bytes + costBytes,
        lastUsedAt: now,
      });
      await tx
        .update(schema.rateLimitGlobal)
        .set({
          count: resetGlobal.count + 1,
          bytes: resetGlobal.bytes + costBytes,
        })
        .where(eq(schema.rateLimitGlobal.tableKey, this.tableKey));
      return { allowed: true };
    });
  }

  public async sweep(now: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (;;) {
        const capacity = await this.sweepExpiredBatch(tx, now);
        if (capacity.deleted === 0) {
          return;
        }
      }
    });
  }

  public async getUsage(): Promise<RateLimitUsage> {
    const [global] = await this.db
      .select({
        entries: schema.rateLimitGlobal.entries,
        entryBytes: schema.rateLimitGlobal.entryBytes,
      })
      .from(schema.rateLimitGlobal)
      .where(eq(schema.rateLimitGlobal.tableKey, this.tableKey))
      .limit(1);
    return { entries: global?.entries ?? 0, bytes: global?.entryBytes ?? 0 };
  }

  private async lockGlobal(tx: ResourcesTransaction, now: number): Promise<GlobalRow> {
    // サーバー全体の計数を同じ窓で検査・加算するため、表ごとの全体行をロックして直列化する。
    await tx
      .insert(schema.rateLimitGlobal)
      .values({
        tableKey: this.tableKey,
        windowStartedAt: now,
        count: 0,
        bytes: 0,
      })
      .onConflictDoNothing();
    const row = await this.lockExistingGlobal(tx);
    if (row === undefined) {
      throw new Error("global rate limit row is missing");
    }
    return row;
  }

  private async lockExistingGlobal(tx: ResourcesTransaction): Promise<GlobalRow | undefined> {
    const [row] = await tx
      .select()
      .from(schema.rateLimitGlobal)
      .where(eq(schema.rateLimitGlobal.tableKey, this.tableKey))
      .for("update");
    return row;
  }

  private async resetGlobalIfExpired(
    tx: ResourcesTransaction,
    global: GlobalRow,
    now: number,
  ): Promise<GlobalRow> {
    if (now < global.windowStartedAt + this.options.windowMs) {
      return global;
    }
    const reset = { ...global, windowStartedAt: now, count: 0, bytes: 0 };
    await tx
      .update(schema.rateLimitGlobal)
      .set(reset)
      .where(eq(schema.rateLimitGlobal.tableKey, this.tableKey));
    return reset;
  }

  private async lockEntry(
    tx: ResourcesTransaction,
    key: string,
  ): Promise<typeof schema.rateLimitEntry.$inferSelect | undefined> {
    const [row] = await tx
      .select()
      .from(schema.rateLimitEntry)
      .where(
        and(
          eq(schema.rateLimitEntry.tableKey, this.tableKey),
          eq(schema.rateLimitEntry.entryKey, key),
        ),
      )
      .for("update");
    return row;
  }

  private async sweepExpiredBatch(
    tx: ResourcesTransaction,
    now: number,
  ): Promise<{ readonly entries: number; readonly entryBytes: number; readonly deleted: number }> {
    // consume と同じ global → entry の順でロックし、sweep と consume のデッドロックを防ぐ。
    // global 行がない場合は entry も存在しないため、ここで作成しない。
    if ((await this.lockExistingGlobal(tx)) === undefined) {
      return { entries: 0, entryBytes: 0, deleted: 0 };
    }
    const deleted = await tx.execute(sql`
      WITH expired AS (
        SELECT entry_key
        FROM rate_limit_entry
        WHERE table_key = ${this.tableKey}
          AND last_used_at + ${this.options.idleTtlMs} <= ${now}
          AND window_started_at + ${this.options.windowMs} <= ${now}
        ORDER BY last_used_at
        LIMIT ${SWEEP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM rate_limit_entry e
      USING expired
      WHERE e.table_key = ${this.tableKey}
        AND e.entry_key = expired.entry_key
      RETURNING e.size_bytes
    `);
    const rows = deleted.rows as { size_bytes: string | number }[];
    const deletedBytes = rows.reduce((total, row) => total + Number(row.size_bytes), 0);
    if (rows.length > 0) {
      await tx
        .update(schema.rateLimitGlobal)
        .set({
          entries: sql`greatest(${schema.rateLimitGlobal.entries} - ${rows.length}, 0)`,
          entryBytes: sql`greatest(${schema.rateLimitGlobal.entryBytes} - ${deletedBytes}, 0)`,
        })
        .where(eq(schema.rateLimitGlobal.tableKey, this.tableKey));
    }
    const [global] = await tx
      .select({
        entries: schema.rateLimitGlobal.entries,
        entryBytes: schema.rateLimitGlobal.entryBytes,
      })
      .from(schema.rateLimitGlobal)
      .where(eq(schema.rateLimitGlobal.tableKey, this.tableKey))
      .limit(1);
    return {
      entries: global?.entries ?? 0,
      entryBytes: global?.entryBytes ?? 0,
      deleted: rows.length,
    };
  }

  private async updateEntry(
    tx: ResourcesTransaction,
    entry: typeof schema.rateLimitEntry.$inferSelect,
  ): Promise<void> {
    await tx
      .update(schema.rateLimitEntry)
      .set({
        windowStartedAt: entry.windowStartedAt,
        count: entry.count,
        bytes: entry.bytes,
        lastUsedAt: entry.lastUsedAt,
      })
      .where(
        and(
          eq(schema.rateLimitEntry.tableKey, this.tableKey),
          eq(schema.rateLimitEntry.entryKey, entry.entryKey),
        ),
      );
  }
}

export function createPostgresRateLimitTable(
  options: PostgresRateLimitTableOptions,
): PostgresRateLimitTable {
  return new PostgresRateLimitTable(options);
}
