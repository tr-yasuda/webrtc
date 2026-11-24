import { beforeEach, describe, expect, test } from "vitest";
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
  type ResourceEvent,
  type ResourceStore,
  type ReserveResult,
} from "../src/index.js";

const serverScope: QuotaScope = { kind: "server", key: "server-a" };
const userScope: QuotaScope = { kind: "user", key: "user-a" };
const workerId = asWorkerId("worker-a");
const bootId = asBootId("boot-1");

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

async function createStore(maxCount = 2, maxBytes = 10): Promise<ResourceStore> {
  const store = createInMemoryResourceStore({ reservationTtlMs: 1_000 });
  await store.setQuotaLimit({ scope: serverScope, maxCount, maxBytes });
  await store.setQuotaLimit({ scope: userScope, maxCount, maxBytes });
  return store;
}

async function reserve(
  store: ResourceStore,
  operationValue: string,
  now = 0,
): Promise<ReserveResult> {
  return store.reserve(claim(), operation(operationValue), now);
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

describe("インメモリ資源管理の受け入れ条件", () => {
  let store: ResourceStore;

  beforeEach(async () => {
    store = await createStore();
  });

  test("空き枠1への並行要求では1件だけ確保に成功する", async () => {
    store = await createStore(1, 10);
    const results = await Promise.all([
      store.reserve(claim(), operation("reserve-1"), 0),
      store.reserve(claim(), operation("reserve-2"), 0),
    ]);

    expect(results.filter((result) => result.status === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({
      usedCount: 1,
      usedBytes: 1,
    });
  });

  test("確保通知が重複しても計上を増やさない", async () => {
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }

    const firstAllocation = await allocate(
      store,
      reserved.reservation.id,
      "resource-1",
      "allocate-1",
    );
    const duplicate = await store.applyEvent(
      {
        type: "allocated",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("allocate-1"),
        at: 2,
      },
      0,
    );

    expect(duplicate).toEqual(firstAllocation);
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("解放通知の消失後も照合で解放を確定できる", async () => {
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }

    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1");
    await store.applyEvent(
      {
        type: "release-requested",
        reservationId: reserved.reservation.id,
        operationId: operation("release-request"),
        at: 2,
      },
      0,
    );
    await store.applyEvent(
      {
        type: "outcome-unknown",
        reservationId: reserved.reservation.id,
        operationId: operation("release-unknown"),
        at: 3,
      },
      0,
    );

    const released = await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-confirmed"),
        at: 4,
      },
      0,
    );

    expect(released).toMatchObject({ status: "applied" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({
      usedCount: 0,
      usedBytes: 0,
    });
  });

  test("確保直後の完了通知を失っても照合で結果を確定する", async () => {
    store = await createStore(1, 10);
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "outcome-unknown",
        reservationId: reserved.reservation.id,
        operationId: operation("allocate-unknown"),
        at: 1,
      },
      0,
    );
    expect(await reserve(store, "reserve-2")).toMatchObject({
      status: "rejected",
      reason: "quota-exceeded",
    });

    const resolved = await allocate(
      store,
      reserved.reservation.id,
      "resource-1",
      "allocate-recovered",
      2,
    );
    expect(resolved).toMatchObject({ status: "applied" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("解放通知が重複しても二重返却しない", async () => {
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }

    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1");
    const releaseEvent: ResourceEvent = {
      type: "released",
      reservationId: reserved.reservation.id,
      resourceId: asResourceId("resource-1"),
      workerId,
      bootId,
      operationId: operation("release-1"),
      at: 2,
    };
    await store.applyEvent(releaseEvent, 0);
    const duplicate = await store.applyEvent(releaseEvent, 0);
    const lateDuplicate = await store.applyEvent(
      { ...releaseEvent, operationId: operation("release-2"), at: 3 },
      0,
    );

    expect(duplicate).toMatchObject({ status: "applied" });
    expect(lateDuplicate).toMatchObject({ status: "ignored", reason: "already-released" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({
      usedCount: 0,
      usedBytes: 0,
    });
  });

  test("遅延した解放通知が再利用後の別資源を変更しない", async () => {
    const first = await reserve(store, "reserve-1");
    if (first.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, first.reservation.id, "resource-1", "allocate-1");
    await store.applyEvent(
      {
        type: "released",
        reservationId: first.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-1"),
        at: 2,
      },
      0,
    );

    const second = await reserve(store, "reserve-2");
    if (second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, second.reservation.id, "resource-2", "allocate-2");
    const delayed = await store.applyEvent(
      {
        type: "released",
        reservationId: first.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-3"),
        at: 3,
      },
      0,
    );

    expect(delayed).toMatchObject({ status: "ignored", reason: "already-released" });
    expect(await store.getReservation(second.reservation.id)).toMatchObject({
      state: "in-use",
      resourceId: "resource-2",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("Worker 再起動後は解放を確認できた資源だけを回収する", async () => {
    const first = await reserve(store, "reserve-1");
    const second = await reserve(store, "reserve-2");
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, first.reservation.id, "resource-1", "allocate-1");
    await allocate(store, second.reservation.id, "resource-2", "allocate-2");

    const started = await store.applyEvent(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [asResourceId("resource-1")],
        operationId: operation("worker-stopped-1"),
        at: 2,
      },
      0,
    );
    if (started.status !== "reconciliation-started") {
      throw new Error("reconciliation did not start");
    }
    const reclaimed = await store.continueReconciliation(started.job.id, { cursor: 0 }, 0);

    expect(reclaimed).toMatchObject({
      reclaimed: [first.reservation.id],
      isolated: [second.reservation.id],
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });

    const staleBoot = await store.applyEvent(
      {
        type: "released",
        reservationId: second.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId: asBootId("boot-2"),
        operationId: operation("release-stale-boot"),
        at: 3,
      },
      0,
    );
    expect(staleBoot).toMatchObject({ status: "ignored", reason: "stale-boot" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });

    const confirmed = await store.applyEvent(
      {
        type: "released",
        reservationId: second.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("release-2"),
        at: 4,
      },
      0,
    );
    expect(confirmed).toMatchObject({ status: "applied" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });
  });

  test("結果不明の間は枠を返却しない", async () => {
    store = await createStore(1, 10);
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1");
    await store.applyEvent(
      {
        type: "outcome-unknown",
        reservationId: reserved.reservation.id,
        operationId: operation("unknown-1"),
        at: 2,
      },
      0,
    );

    const second = await reserve(store, "reserve-2");
    expect(second).toMatchObject({ status: "rejected", reason: "quota-exceeded" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("期限切れの予約は解放し、使用中の資源は隔離して計上を続ける", async () => {
    const reserved = await store.reserve(claim(1, 10), operation("reserve-1"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }

    const expired = await store.expire(10);
    expect(expired.released).toEqual([reserved.reservation.id]);
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "released",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });

    const inUse = await store.reserve(claim(1, 10), operation("reserve-2"), 0);
    if (inUse.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, inUse.reservation.id, "resource-2", "allocate-2");
    await store.expire(10);

    expect(await store.getReservation(inUse.reservation.id)).toMatchObject({
      state: "isolated",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("expire は limit 件ずつ処理し、隔離済みを次回対象にしない", async () => {
    const batchStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      reconciliationBatchSize: 2,
    });
    await batchStore.setQuotaLimit({ scope: serverScope, maxCount: 5, maxBytes: 10 });
    await batchStore.setQuotaLimit({ scope: userScope, maxCount: 5, maxBytes: 10 });
    const first = await batchStore.reserve(claim(1, 5), operation("reserve-1"), 0);
    const second = await batchStore.reserve(claim(1, 5), operation("reserve-2"), 0);
    const third = await batchStore.reserve(claim(1, 5), operation("reserve-3"), 0);
    if (
      first.status !== "reserved" ||
      second.status !== "reserved" ||
      third.status !== "reserved"
    ) {
      throw new Error("reservation failed");
    }
    await allocate(batchStore, second.reservation.id, "resource-2", "allocate-2", 0);

    const firstBatch = await batchStore.expire(5, { limit: 2 });
    expect(firstBatch.released.length + firstBatch.isolated.length).toBe(2);
    expect(firstBatch.hasMore).toBe(true);

    const secondBatch = await batchStore.expire(5, { limit: 2 });
    expect(secondBatch.released.length + secondBatch.isolated.length).toBe(1);
    expect(secondBatch.hasMore).toBe(false);

    expect(await batchStore.expire(5, { limit: 2 })).toEqual({
      released: [],
      isolated: [],
      hasMore: false,
    });
    expect(await batchStore.getReservation(second.reservation.id)).toMatchObject({
      state: "isolated",
    });
  });

  test("予約と資源の対応が違う通知を拒否する", async () => {
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1");

    const mismatched = await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("release-1"),
        at: 2,
      },
      0,
    );

    expect(mismatched).toMatchObject({
      status: "rejected",
      reason: "correlation-mismatch",
    });
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "in-use",
    });
  });

  test("同じ操作IDの再送は保存済みの結果を返す", async () => {
    const first = await reserve(store, "reserve-1");
    const second = await reserve(store, "reserve-1");

    expect(second).toEqual(first);
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("操作記録の監査時刻には予約時と通知時の時刻を保存する", async () => {
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    expect(await store.getOperationOccurredAt(operation("reserve-1"))).toBe(0);

    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1", 3);
    expect(await store.getOperationOccurredAt(operation("allocate-1"))).toBe(3);
    expect(await store.getOperationRecordedAt(operation("allocate-1"))).toBe(0);
  });

  test("上限が未設定のスコープでは予約を拒否する", async () => {
    const unconfigured = createInMemoryResourceStore({ reservationTtlMs: 1_000 });
    const result = await unconfigured.reserve(claim(), operation("reserve-1"), 0);

    expect(result).toMatchObject({
      status: "rejected",
      reason: "limit-not-configured",
    });
  });

  test("解放失敗の通知では使用中に戻し計上を維持する", async () => {
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1");
    await store.applyEvent(
      {
        type: "release-requested",
        reservationId: reserved.reservation.id,
        operationId: operation("release-request"),
        at: 2,
      },
      0,
    );
    const failed = await store.applyEvent(
      {
        type: "release-failed",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-failed"),
        at: 3,
      },
      0,
    );

    expect(failed).toMatchObject({ status: "applied" });
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "in-use",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("使用中の TTL を設定すると確保後の期限を上書きする", async () => {
    const ttlStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      inUseTtlMs: 5,
    });
    await ttlStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await ttlStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const reserved = await ttlStore.reserve(claim(), operation("reserve-1"), 0);
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(ttlStore, reserved.reservation.id, "resource-1", "allocate-1", 0);

    expect(await ttlStore.getReservation(reserved.reservation.id)).toMatchObject({
      state: "in-use",
      expiresAt: 5,
    });
    expect((await ttlStore.expire(4)).released).toEqual([]);
    expect((await ttlStore.expire(5)).isolated).toEqual([reserved.reservation.id]);
    expect(await ttlStore.getReservation(reserved.reservation.id)).toMatchObject({
      state: "isolated",
    });
    expect(await ttlStore.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });
  });

  test("ルーム単位の上限を超える予約を拒否する", async () => {
    const roomScope: QuotaScope = { kind: "room", key: "room-a" };
    const roomStore = await createStore(5, 10);
    await roomStore.setQuotaLimit({ scope: roomScope, maxCount: 1, maxBytes: 10 });
    const roomClaim: ResourceClaim = {
      scopes: [serverScope, roomScope, userScope],
      sizeBytes: 1,
    };

    expect(await roomStore.reserve(roomClaim, operation("room-1"), 0)).toMatchObject({
      status: "reserved",
    });
    expect(await roomStore.reserve(roomClaim, operation("room-2"), 0)).toMatchObject({
      status: "rejected",
      reason: "quota-exceeded",
    });
    expect(await roomStore.getQuotaUsage(roomScope)).toMatchObject({ usedCount: 1 });
  });

  test("server スコープがない予約を拒否する", async () => {
    const userOnlyClaim: ResourceClaim = {
      scopes: [userScope],
      sizeBytes: 1,
    };

    expect(await store.reserve(userOnlyClaim, operation("reserve-user-only"), 0)).toMatchObject({
      status: "rejected",
      reason: "invalid-claim",
    });
    expect(await store.getQuotaUsage(userScope)).toMatchObject({ usedCount: 0 });
  });
});
