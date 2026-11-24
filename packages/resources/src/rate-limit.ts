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
  expiresAt: number;
  generation: number;
}

interface ExpiryRecord {
  readonly key: string;
  readonly expiresAt: number;
  readonly generation: number;
}

class ExpiryHeap {
  private readonly items: ExpiryRecord[] = [];

  public get size(): number {
    return this.items.length;
  }

  public peek(): ExpiryRecord | undefined {
    return this.items[0];
  }

  public clear(): void {
    this.items.length = 0;
  }

  public push(record: ExpiryRecord): void {
    this.items.push(record);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!isEarlierExpiry(this.items[index]!, this.items[parent]!)) {
        break;
      }
      [this.items[index], this.items[parent]] = [this.items[parent]!, this.items[index]!];
      index = parent;
    }
  }

  public pop(): ExpiryRecord | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (first === undefined || last === undefined || this.items.length === 0) {
      return first;
    }
    this.items[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && isEarlierExpiry(this.items[left]!, this.items[smallest]!)) {
        smallest = left;
      }
      if (right < this.items.length && isEarlierExpiry(this.items[right]!, this.items[smallest]!)) {
        smallest = right;
      }
      if (smallest === index) {
        return first;
      }
      [this.items[index], this.items[smallest]] = [this.items[smallest]!, this.items[index]!];
      index = smallest;
    }
  }
}

function isEarlierExpiry(left: ExpiryRecord, right: ExpiryRecord): boolean {
  return (
    left.expiresAt < right.expiresAt || (left.expiresAt === right.expiresAt && left.key < right.key)
  );
}

function entryExpiry(
  lastUsedAt: number,
  windowStartedAt: number,
  idleTtlMs: number,
  windowMs: number,
): number {
  return Math.max(lastUsedAt + idleTtlMs, windowStartedAt + windowMs);
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
  private readonly expiryHeap = new ExpiryHeap();

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
        expiresAt: 0,
        generation: 0,
      };
      this.entries.set(key, entry);
      this.entryBytes += sizeBytes;
      this.refreshExpiry(key, entry);
    } else if (now >= entry.windowStartedAt + this.options.windowMs) {
      entry.windowStartedAt = now;
      entry.count = 0;
      entry.bytes = 0;
    }

    entry.lastUsedAt = now;
    this.refreshExpiry(key, entry);
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
    for (;;) {
      const record = this.expiryHeap.peek();
      if (record === undefined || record.expiresAt > now) {
        return;
      }
      this.expiryHeap.pop();
      const entry = this.entries.get(record.key);
      if (
        entry === undefined ||
        entry.generation !== record.generation ||
        entry.expiresAt !== record.expiresAt
      ) {
        continue;
      }
      this.entries.delete(record.key);
      this.entryBytes -= entry.sizeBytes;
    }
  }

  private refreshExpiry(key: string, entry: RateLimitEntry): void {
    entry.generation += 1;
    entry.expiresAt = entryExpiry(
      entry.lastUsedAt,
      entry.windowStartedAt,
      this.options.idleTtlMs,
      this.options.windowMs,
    );
    this.expiryHeap.push({
      key,
      expiresAt: entry.expiresAt,
      generation: entry.generation,
    });
    // 同一キーへの要求ごとに期限レコードを積むため、entries に対して有界に保つ。
    if (this.expiryHeap.size <= Math.max(64, this.entries.size * 2)) {
      return;
    }
    this.expiryHeap.clear();
    for (const [currentKey, current] of this.entries) {
      this.expiryHeap.push({
        key: currentKey,
        expiresAt: current.expiresAt,
        generation: current.generation,
      });
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
