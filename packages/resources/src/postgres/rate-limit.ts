import { and, count, eq, sql } from "drizzle-orm";
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
}

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
        await this.sweepExpired(tx, now);
        const usage = await this.readUsage(tx);
        if (usage.entries >= this.options.maxEntries) {
          return { allowed: false, reason: "entry-limit" };
        }
        const sizeBytes = entrySize(key, this.options.entryOverheadBytes);
        if (usage.bytes + sizeBytes > this.options.maxBytes) {
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
      await this.sweepExpired(tx, now);
    });
  }

  public async getUsage(): Promise<RateLimitUsage> {
    const [usage] = await this.db
      .select({
        entries: count(),
        bytes: sql<number>`coalesce(sum(${schema.rateLimitEntry.sizeBytes}), 0)`,
      })
      .from(schema.rateLimitEntry)
      .where(eq(schema.rateLimitEntry.tableKey, this.tableKey));
    return {
      entries: Number(usage?.entries ?? 0),
      bytes: Number(usage?.bytes ?? 0),
    };
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
    const [row] = await tx
      .select()
      .from(schema.rateLimitGlobal)
      .where(eq(schema.rateLimitGlobal.tableKey, this.tableKey))
      .for("update");
    if (row === undefined) {
      throw new Error("global rate limit row is missing");
    }
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
    const reset = { windowStartedAt: now, count: 0, bytes: 0 };
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

  private async readUsage(
    tx: ResourcesTransaction,
  ): Promise<{ readonly entries: number; readonly bytes: number }> {
    const [usage] = await tx
      .select({
        entries: count(),
        bytes: sql<number>`coalesce(sum(${schema.rateLimitEntry.sizeBytes}), 0)`,
      })
      .from(schema.rateLimitEntry)
      .where(eq(schema.rateLimitEntry.tableKey, this.tableKey));
    return {
      entries: Number(usage?.entries ?? 0),
      bytes: Number(usage?.bytes ?? 0),
    };
  }

  private async sweepExpired(tx: ResourcesTransaction, now: number): Promise<void> {
    await tx
      .delete(schema.rateLimitEntry)
      .where(
        and(
          eq(schema.rateLimitEntry.tableKey, this.tableKey),
          sql`${schema.rateLimitEntry.lastUsedAt} + ${this.options.idleTtlMs} <= ${now}`,
          sql`${schema.rateLimitEntry.windowStartedAt} + ${this.options.windowMs} <= ${now}`,
        ),
      );
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
