import { describe, expect, test } from "vitest";
import {
  asBootId,
  asOperationId,
  asResourceId,
  asWorkerId,
  createInMemoryResourceStore,
  type ApplyEventResult,
  type QuotaScope,
  type ReservationId,
  type ResourceClaim,
  type ResourceStore,
} from "../src/index.js";

const serverScope: QuotaScope = { kind: "server", key: "server-a" };
const userScope: QuotaScope = { kind: "user", key: "user-a" };
const workerId = asWorkerId("worker-a");
const bootId = asBootId("boot-1");
const DAY_MS = 24 * 60 * 60 * 1_000;

function claim(sizeBytes = 1, ttlMs?: number): ResourceClaim {
  return {
    scopes: [serverScope, userScope],
    sizeBytes,
    ...(ttlMs === undefined ? {} : { ttlMs }),
  };
}

function operation(value: string) {
  return asOperationId(value);
}

async function allocate(
  store: ResourceStore,
  reservationId: ReservationId,
  resourceId: string,
  operationValue: string,
  now = 1,
): Promise<ApplyEventResult> {
  return store.applyEvent(
    {
      type: "allocated",
      reservationId,
      resourceId: asResourceId(resourceId),
      workerId,
      bootId,
      operationId: operation(operationValue),
      at: now,
    },
    0,
  );
}

describe("インメモリ資源管理の保持と容量", () => {
  test("保持期間を過ぎた操作記録と解放済み tombstone だけを削除する", async () => {
    const cleanupStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      operationRetentionMs: DAY_MS,
      releasedReservationRetentionMs: 7 * DAY_MS,
      cleanupBatchSize: 10,
    });
    await cleanupStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await cleanupStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const reserved = await cleanupStore.reserve(claim(), operation("reserve-1"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(cleanupStore, reserved.reservation.id, "resource-1", "allocate-1", 0);
    await cleanupStore.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-1"),
        at: 0,
      },
      0,
    );

    expect(await cleanupStore.cleanup(DAY_MS - 1)).toMatchObject({
      deletedOperations: 0,
      deletedReleasedReservations: 0,
    });
    expect(await cleanupStore.getOperationRecordedAt(operation("reserve-1"))).toBe(0);
    expect(await cleanupStore.getReservation(reserved.reservation.id)).not.toBeUndefined();

    expect(await cleanupStore.cleanup(DAY_MS)).toMatchObject({
      deletedOperations: 3,
      deletedReleasedReservations: 0,
    });
    expect(await cleanupStore.getOperationRecordedAt(operation("reserve-1"))).toBeUndefined();
    expect(await cleanupStore.getReservation(reserved.reservation.id)).not.toBeUndefined();

    expect(await cleanupStore.cleanup(7 * DAY_MS)).toMatchObject({
      deletedOperations: 0,
      deletedReleasedReservations: 1,
    });
    expect(await cleanupStore.getReservation(reserved.reservation.id)).toBeUndefined();
  });

  test("cleanup はバッチ件数ずつ削除する", async () => {
    const cleanupStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      cleanupBatchSize: 1,
    });
    await cleanupStore.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await cleanupStore.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    await cleanupStore.reserve(claim(), operation("reserve-1"), 0);
    await cleanupStore.reserve(claim(), operation("reserve-2"), 0);

    expect(await cleanupStore.cleanup(DAY_MS)).toMatchObject({ deletedOperations: 1 });
    expect(await cleanupStore.cleanup(DAY_MS)).toMatchObject({ deletedOperations: 1 });
    expect(await cleanupStore.cleanup(DAY_MS)).toMatchObject({ deletedOperations: 0 });
  });

  test("cleanup は使用中の予約を削除しない", async () => {
    const cleanupStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      cleanupBatchSize: 10,
    });
    await cleanupStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await cleanupStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const reserved = await cleanupStore.reserve(claim(), operation("reserve-1"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(cleanupStore, reserved.reservation.id, "resource-1", "allocate-1", 0);

    expect(await cleanupStore.cleanup(30 * DAY_MS)).toMatchObject({
      deletedReleasedReservations: 0,
    });
    expect(await cleanupStore.getReservation(reserved.reservation.id)).toMatchObject({
      state: "in-use",
    });
    expect(await cleanupStore.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("操作記録が上限に達すると cleanup 後は新規操作を拒否する", async () => {
    const cappedStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      maxOperationRecords: 1,
    });
    await cappedStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await cappedStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    expect(await cappedStore.reserve(claim(), operation("reserve-1"), 0)).toMatchObject({
      status: "reserved",
    });

    const atCapacity = await cappedStore.cleanup(0);
    expect(atCapacity.operationCount).toBe(1);
    expect(atCapacity.operationCapacityExceeded).toBe(true);
    expect(await cappedStore.reserve(claim(), operation("reserve-2"), 0)).toMatchObject({
      status: "rejected",
      reason: "capacity-exhausted",
    });

    const afterExpiry = await cappedStore.cleanup(DAY_MS);
    expect(afterExpiry.operationCount).toBe(0);
    expect(afterExpiry.operationCapacityExceeded).toBe(false);
    expect(await cappedStore.reserve(claim(), operation("reserve-3"), DAY_MS)).toMatchObject({
      status: "reserved",
    });
  });

  test("操作記録が上限に達すると新規通知も拒否する", async () => {
    const cappedStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      maxOperationRecords: 1,
    });
    await cappedStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await cappedStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const reserved = await cappedStore.reserve(claim(), operation("reserve-1"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await cappedStore.cleanup(0);

    expect(
      await cappedStore.applyEvent(
        {
          type: "allocated",
          reservationId: reserved.reservation.id,
          resourceId: asResourceId("resource-1"),
          workerId,
          bootId,
          operationId: operation("allocate-1"),
          at: 1,
        },
        1,
      ),
    ).toMatchObject({ status: "rejected", reason: "capacity-exhausted" });
    expect(await cappedStore.getReservation(reserved.reservation.id)).toMatchObject({
      state: "reserved",
    });
    expect(await cappedStore.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("tombstone が上限を超えると古いものから削除する", async () => {
    const cappedStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      maxReleasedReservations: 1,
    });
    await cappedStore.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await cappedStore.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    const first = await cappedStore.reserve(claim(), operation("reserve-1"), 0);
    const second = await cappedStore.reserve(claim(), operation("reserve-2"), 1);
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(cappedStore, first.reservation.id, "resource-1", "allocate-1", 0);
    await allocate(cappedStore, second.reservation.id, "resource-2", "allocate-2", 1);
    for (const [reservation, now] of [
      [first.reservation, 0],
      [second.reservation, 1],
    ] as const) {
      await cappedStore.applyEvent(
        {
          type: "released",
          reservationId: reservation.id,
          resourceId: asResourceId(now === 0 ? "resource-1" : "resource-2"),
          workerId,
          bootId,
          operationId: operation(`release-${now}`),
          at: now,
        },
        now,
      );
    }

    const evicted = await cappedStore.cleanup(2);
    expect(evicted.releasedReservationCount).toBe(1);
    expect(evicted.evictedReleasedReservations).toBe(1);
    expect(await cappedStore.getReservation(first.reservation.id)).toBeUndefined();
    expect(await cappedStore.getReservation(second.reservation.id)).not.toBeUndefined();
  });

  test("スコープ数が上限を超える予約を拒否する", async () => {
    const cappedStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      maxScopesPerClaim: 2,
    });
    const roomScope: QuotaScope = { kind: "room", key: "room-a" };
    expect(
      await cappedStore.reserve(
        {
          scopes: [serverScope, roomScope, userScope],
          sizeBytes: 1,
        },
        operation("too-many-scopes"),
        0,
      ),
    ).toMatchObject({ status: "rejected", reason: "invalid-claim" });
  });

  test("内部一覧は ID 順にページングし、重複・欠落しない", async () => {
    const listStore = createInMemoryResourceStore({ reservationTtlMs: 1_000 });
    await listStore.setQuotaLimit({ scope: serverScope, maxCount: 5, maxBytes: 10 });
    await listStore.setQuotaLimit({ scope: userScope, maxCount: 5, maxBytes: 10 });
    const expected: ReservationId[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = await listStore.reserve(claim(), operation(`reserve-${index}`), 0);
      if (result.status !== "reserved") {
        throw new Error("reservation failed");
      }
      expected.push(result.reservation.id);
    }

    const collected: ReservationId[] = [];
    let cursor: ReservationId | undefined;
    for (;;) {
      const page = await listStore.listReservationsPage(
        {},
        { limit: 2, ...(cursor === undefined ? {} : { cursor }) },
      );
      collected.push(...page.reservations.map((reservation) => reservation.id));
      if (page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(collected).toEqual(expected.toSorted());
    expect(new Set(collected).size).toBe(collected.length);
  });
});
