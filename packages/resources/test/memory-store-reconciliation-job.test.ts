import { beforeEach, describe, expect, test } from "vitest";
import {
  asBootId,
  asOperationId,
  asReconciliationJobId,
  asResourceId,
  asWorkerId,
  createInMemoryResourceStore,
  ReconciliationCapacityError,
  ReconciliationCursorMismatchError,
  ReconciliationJobNotFoundError,
  type ApplyEventResult,
  type QuotaScope,
  type ReservationId,
  type ResourceClaim,
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

  test("照合ジョブは開始後の遅延確保を target_seq で取りこぼさない", async () => {
    const jobStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      reconciliationBatchSize: 1,
    });
    await jobStore.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await jobStore.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    const delayed = await reserve(jobStore, "reserve-delayed");
    const allocated = await reserve(jobStore, "reserve-allocated");
    if (delayed.status !== "reserved" || allocated.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(jobStore, allocated.reservation.id, "resource-2", "allocate-1", 1);

    const job = await jobStore.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-1"),
        at: 2,
      },
      2,
    );
    expect(job).toMatchObject({ status: "pending", targetCount: 1, lastTargetSeq: 0 });

    const firstBatch = await jobStore.continueReconciliation(job.id, { cursor: 0 }, 2);
    expect(firstBatch).toMatchObject({
      isolated: [allocated.reservation.id],
      hasMore: false,
      status: "completed",
    });
    if (firstBatch.nextCursor === undefined) {
      throw new Error("cursor is missing");
    }

    const lateAllocation = await jobStore.applyEvent(
      {
        type: "allocated",
        reservationId: delayed.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("allocate-late"),
        at: 3,
      },
      3,
    );
    expect(lateAllocation).toMatchObject({ status: "applied" });
    expect(await jobStore.getReconciliationJob(job.id)).toMatchObject({
      status: "pending",
      targetCount: 2,
      lastTargetSeq: firstBatch.nextCursor,
    });

    const secondBatch = await jobStore.continueReconciliation(
      job.id,
      { cursor: firstBatch.nextCursor },
      4,
    );
    expect(secondBatch).toMatchObject({
      isolated: [delayed.reservation.id],
      hasMore: false,
      status: "completed",
    });
    expect(await jobStore.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 2 });
  });

  test("存在しない照合ジョブと古いカーソルを拒否する", async () => {
    await expect(
      store.continueReconciliation(asReconciliationJobId("missing"), { cursor: 0 }, 0),
    ).rejects.toBeInstanceOf(ReconciliationJobNotFoundError);

    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId: asBootId("boot-empty"),
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-empty"),
        at: 0,
      },
      0,
    );
    await expect(store.continueReconciliation(job.id, { cursor: 1 }, 0)).rejects.toBeInstanceOf(
      ReconciliationCursorMismatchError,
    );
  });

  test("照合対象が処理前に解放された場合は unchanged に含めない", async () => {
    const reserved = await reserve(store, "reserve-released-before-reconciliation");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1", 1);
    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-before-release"),
        at: 2,
      },
      2,
    );
    expect(job.targetCount).toBe(1);

    await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-before-reconciliation"),
        at: 3,
      },
      3,
    );

    expect(await store.continueReconciliation(job.id, { cursor: 0 }, 3)).toMatchObject({
      reclaimed: [],
      isolated: [],
      unchanged: [],
      hasMore: false,
      status: "completed",
    });
  });

  test("完了した照合ジョブだけを保持期間後に削除する", async () => {
    const jobStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      reconciliationJobRetentionMs: 100,
    });
    await jobStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await jobStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const reserved = await reserve(jobStore, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(jobStore, reserved.reservation.id, "resource-1", "allocate-1", 0);
    const job = await jobStore.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-1"),
        at: 0,
      },
      0,
    );
    await jobStore.continueReconciliation(job.id, { cursor: 0 }, 0);

    expect(await jobStore.cleanup(99)).toMatchObject({ deletedReconciliationJobs: 0 });
    expect(await jobStore.getReconciliationJob(job.id)).not.toBeUndefined();
    expect(await jobStore.cleanup(100)).toMatchObject({ deletedReconciliationJobs: 1 });
    expect(await jobStore.getReconciliationJob(job.id)).toBeUndefined();
  });

  test("照合ジョブの対象件数と確認済み資源数が上限を超えると開始しない", async () => {
    const confirmedStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      maxConfirmedResourceIds: 1,
    });
    await expect(
      confirmedStore.startReconciliation(
        {
          type: "worker-stopped",
          workerId,
          bootId,
          confirmedResourceIds: [asResourceId("resource-1"), asResourceId("resource-2")],
          operationId: operation("worker-stopped-1"),
          at: 0,
        },
        0,
      ),
    ).rejects.toBeInstanceOf(ReconciliationCapacityError);

    const targetStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      maxReconciliationTargets: 1,
    });
    await targetStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await targetStore.setQuotaLimit({ scope: userScope, maxCount: 2, maxBytes: 10 });
    const first = await reserve(targetStore, "reserve-1");
    const second = await reserve(targetStore, "reserve-2");
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(targetStore, first.reservation.id, "resource-1", "allocate-1", 0);
    await allocate(targetStore, second.reservation.id, "resource-2", "allocate-2", 0);
    await expect(
      targetStore.startReconciliation(
        {
          type: "worker-stopped",
          workerId,
          bootId,
          confirmedResourceIds: [],
          operationId: operation("worker-stopped-2"),
          at: 0,
        },
        0,
      ),
    ).rejects.toBeInstanceOf(ReconciliationCapacityError);
  });

  test("照合対象の上限を超える確保通知は容量超過で拒否する", async () => {
    const cappedStore = createInMemoryResourceStore({
      reservationTtlMs: 1_000,
      maxReconciliationTargets: 1,
    });
    await cappedStore.setQuotaLimit({ scope: serverScope, maxCount: 3, maxBytes: 10 });
    await cappedStore.setQuotaLimit({ scope: userScope, maxCount: 3, maxBytes: 10 });
    const first = await reserve(cappedStore, "reserve-1");
    const second = await reserve(cappedStore, "reserve-2");
    if (first.status !== "reserved" || second.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(cappedStore, first.reservation.id, "resource-1", "allocate-1", 0);
    const started = await cappedStore.applyEvent(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-1"),
        at: 1,
      },
      1,
    );
    if (started.status !== "reconciliation-started") {
      throw new Error("reconciliation did not start");
    }

    const late = await cappedStore.applyEvent(
      {
        type: "allocated",
        reservationId: second.reservation.id,
        resourceId: asResourceId("resource-2"),
        workerId,
        bootId,
        operationId: operation("allocate-late"),
        at: 2,
      },
      2,
    );
    expect(late).toMatchObject({ status: "rejected", reason: "capacity-exhausted" });
    expect(await cappedStore.getReservation(second.reservation.id)).toMatchObject({
      state: "reserved",
    });
    expect(await cappedStore.getReconciliationJob(started.job.id)).toMatchObject({
      targetCount: 1,
    });
  });

  test("明示的な隔離は計上を維持し、解放確認で返却する", async () => {
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1", 1);

    const isolated = await store.applyEvent(
      {
        type: "isolate",
        reservationId: reserved.reservation.id,
        operationId: operation("isolate-1"),
        at: 2,
      },
      2,
    );
    expect(isolated).toMatchObject({
      status: "applied",
      reservation: { state: "isolated" },
    });
    expect(
      await store.applyEvent(
        {
          type: "isolate",
          reservationId: reserved.reservation.id,
          operationId: operation("isolate-1"),
          at: 3,
        },
        3,
      ),
    ).toEqual(isolated);
    expect(
      await store.applyEvent(
        {
          type: "isolate",
          reservationId: reserved.reservation.id,
          operationId: operation("isolate-2"),
          at: 3,
        },
        3,
      ),
    ).toMatchObject({ status: "ignored", reason: "duplicate" });

    expect(await store.expire(2_000)).toMatchObject({
      released: [],
      isolated: [],
      hasMore: false,
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 1 });

    const released = await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-1"),
        at: 4,
      },
      4,
    );
    expect(released).toMatchObject({ status: "applied" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });
  });

  test("解放済みの予約への明示的な隔離は無視する", async () => {
    const reserved = await reserve(store, "reserve-1");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1", 1);
    await store.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-1"),
        workerId,
        bootId,
        operationId: operation("release-1"),
        at: 2,
      },
      2,
    );

    expect(
      await store.applyEvent(
        {
          type: "isolate",
          reservationId: reserved.reservation.id,
          operationId: operation("isolate-late"),
          at: 3,
        },
        3,
      ),
    ).toMatchObject({ status: "ignored", reason: "already-released" });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });
  });

  test("解放待ちへの遅延確保は状態を維持して相関情報を補完する", async () => {
    const reserved = await reserve(store, "reserve-delayed-allocation");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "outcome-unknown",
        reservationId: reserved.reservation.id,
        operationId: operation("unknown-delayed-allocation"),
        at: 1,
      },
      1,
    );
    await store.applyEvent(
      {
        type: "release-requested",
        reservationId: reserved.reservation.id,
        operationId: operation("release-delayed-allocation"),
        at: 2,
      },
      2,
    );

    const applied = await store.applyEvent(
      {
        type: "allocated",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-delayed-allocation"),
        workerId,
        bootId,
        operationId: operation("allocate-delayed-allocation"),
        at: 3,
      },
      3,
    );
    expect(applied).toMatchObject({
      status: "applied",
      reservation: {
        state: "release-pending",
        resourceId: "resource-delayed-allocation",
        workerId,
        bootId,
      },
    });

    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-delayed-allocation"),
        at: 4,
      },
      4,
    );
    expect(job.targetCount).toBe(1);
    expect(await store.continueReconciliation(job.id, { cursor: 0 }, 4)).toMatchObject({
      isolated: [reserved.reservation.id],
    });
  });

  test("隔離済みの資源も停止確認後に解放する", async () => {
    const reserved = await reserve(store, "reserve-isolated-confirmed");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await allocate(store, reserved.reservation.id, "resource-1", "allocate-1", 1);
    await store.applyEvent(
      {
        type: "isolate",
        reservationId: reserved.reservation.id,
        operationId: operation("isolate-1"),
        at: 2,
      },
      2,
    );
    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [asResourceId("resource-1")],
        operationId: operation("worker-stopped-isolated"),
        at: 3,
      },
      3,
    );

    expect(await store.continueReconciliation(job.id, { cursor: 0 }, 3)).toMatchObject({
      reclaimed: [reserved.reservation.id],
      isolated: [],
      unchanged: [],
      hasMore: false,
      status: "completed",
    });
    expect(await store.getReservation(reserved.reservation.id)).toMatchObject({
      state: "released",
    });
    expect(await store.getQuotaUsage(serverScope)).toMatchObject({ usedCount: 0 });
  });

  test("解放失敗への遅延通知は相関情報を補完して照合対象にする", async () => {
    const reserved = await reserve(store, "reserve-release-failed");
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }
    await store.applyEvent(
      {
        type: "outcome-unknown",
        reservationId: reserved.reservation.id,
        operationId: operation("unknown-release-failed"),
        at: 1,
      },
      1,
    );
    const applied = await store.applyEvent(
      {
        type: "release-failed",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-release-failed"),
        workerId,
        bootId,
        operationId: operation("release-failed-late"),
        at: 2,
      },
      2,
    );
    expect(applied).toMatchObject({
      status: "applied",
      reservation: {
        state: "in-use",
        resourceId: "resource-release-failed",
        workerId,
        bootId,
      },
    });

    const job = await store.startReconciliation(
      {
        type: "worker-stopped",
        workerId,
        bootId,
        confirmedResourceIds: [],
        operationId: operation("worker-stopped-release-failed"),
        at: 3,
      },
      3,
    );
    expect(job.targetCount).toBe(1);
    expect(await store.continueReconciliation(job.id, { cursor: 0 }, 3)).toMatchObject({
      isolated: [reserved.reservation.id],
    });
  });
});
