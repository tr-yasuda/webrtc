import type {
  RateLimitDecision,
  RateLimitOptions,
  RateLimitTable,
  RateLimitUsage,
} from "./contract.js";
import { validateRateLimitOptions } from "./contract.js";

interface RateLimitEntry {
  windowStartedAt: number;
  count: number;
  bytes: number;
  lastUsedAt: number;
  readonly sizeBytes: number;
}

function retryAfterMs(windowStartedAt: number, windowMs: number, now: number): number {
  return Math.max(0, windowStartedAt + windowMs - now);
}

function entrySize(key: string, overheadBytes: number): number {
  return overheadBytes + Buffer.byteLength(key, "utf8");
}

export class InMemoryRateLimitTable implements RateLimitTable {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly options: RateLimitOptions;
  private globalWindowStartedAt: number | undefined;
  private globalCount = 0;
  private globalBytes = 0;
  private entryBytes = 0;

  public constructor(options: RateLimitOptions) {
    validateRateLimitOptions(options);
    this.options = options;
  }

  public async consume(key: string, costBytes: number, now: number): Promise<RateLimitDecision> {
    if (key.length === 0 || !Number.isSafeInteger(costBytes) || costBytes < 0) {
      return { allowed: false, reason: "invalid-request" };
    }
    if (costBytes > this.options.maxBytesPerKey) {
      return { allowed: false, reason: "bandwidth-limit" };
    }

    const globalWindowStartedAt = this.resetGlobalWindow(now);
    if (
      this.globalCount + 1 > this.options.maxRequestsGlobal ||
      this.globalBytes + costBytes > this.options.maxBytesGlobal
    ) {
      return {
        allowed: false,
        reason:
          this.globalCount + 1 > this.options.maxRequestsGlobal
            ? "request-limit"
            : "bandwidth-limit",
        retryAfterMs: retryAfterMs(globalWindowStartedAt, this.options.windowMs, now),
      };
    }

    let entry = this.entries.get(key);
    if (entry === undefined) {
      this.sweepNow(now);
      if (this.entries.size >= this.options.maxEntries) {
        return { allowed: false, reason: "entry-limit" };
      }

      const sizeBytes = entrySize(key, this.options.entryOverheadBytes);
      if (this.entryBytes + sizeBytes > this.options.maxBytes) {
        return { allowed: false, reason: "byte-limit" };
      }

      entry = {
        windowStartedAt: now,
        count: 0,
        bytes: 0,
        lastUsedAt: now,
        sizeBytes,
      };
      this.entries.set(key, entry);
      this.entryBytes += sizeBytes;
    } else if (now >= entry.windowStartedAt + this.options.windowMs) {
      entry.windowStartedAt = now;
      entry.count = 0;
      entry.bytes = 0;
    }

    entry.lastUsedAt = now;
    if (
      entry.count + 1 > this.options.maxRequestsPerKey ||
      entry.bytes + costBytes > this.options.maxBytesPerKey
    ) {
      return {
        allowed: false,
        reason:
          entry.count + 1 > this.options.maxRequestsPerKey ? "request-limit" : "bandwidth-limit",
        retryAfterMs: retryAfterMs(entry.windowStartedAt, this.options.windowMs, now),
      };
    }

    entry.count += 1;
    entry.bytes += costBytes;
    this.globalCount += 1;
    this.globalBytes += costBytes;
    return { allowed: true };
  }

  public async sweep(now: number): Promise<void> {
    this.sweepNow(now);
  }

  public async getUsage(): Promise<RateLimitUsage> {
    return { entries: this.entries.size, bytes: this.entryBytes };
  }

  private sweepNow(now: number): void {
    for (const [key, entry] of this.entries) {
      const idleExpired = now >= entry.lastUsedAt + this.options.idleTtlMs;
      const windowExpired = now >= entry.windowStartedAt + this.options.windowMs;
      if (idleExpired && windowExpired) {
        this.entries.delete(key);
        this.entryBytes -= entry.sizeBytes;
      }
    }
  }

  private resetGlobalWindow(now: number): number {
    if (
      this.globalWindowStartedAt === undefined ||
      now >= this.globalWindowStartedAt + this.options.windowMs
    ) {
      this.globalWindowStartedAt = now;
      this.globalCount = 0;
      this.globalBytes = 0;
    }

    return this.globalWindowStartedAt;
  }
}

export function createInMemoryRateLimitTable(options: RateLimitOptions): InMemoryRateLimitTable {
  return new InMemoryRateLimitTable(options);
}
