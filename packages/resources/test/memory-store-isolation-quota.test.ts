import { describe, expect, test } from "vitest";
import {
  asBootId,
  asOperationId,
  asResourceId,
  asWorkerId,
  createInMemoryResourceStore,
  type QuotaScope,
} from "../src/index.js";

const serverScope: QuotaScope = { kind: "server", key: "server-a" };
const workerId = asWorkerId("worker-a");
const bootId = asBootId("boot-1");

function operation(value: string) {
  return asOperationId(value);
}

describe("インメモリ資源管理の隔離と quota 削除", () => {
  test("使用中のスコープは削除せず、解放後に削除できる", async () => {
    const roomScope: QuotaScope = { kind: "room", key: "room-a" };
    const roomStore = createInMemoryResourceStore({ reservationTtlMs: 1_000 });
    await roomStore.setQuotaLimit({ scope: serverScope, maxCount: 2, maxBytes: 10 });
    await roomStore.setQuotaLimit({ scope: roomScope, maxCount: 1, maxBytes: 10 });
    const reserved = await roomStore.reserve(
      { scopes: [serverScope, roomScope], sizeBytes: 1 },
      operation("reserve-room"),
      0,
    );
    if (reserved.status !== "reserved") {
      throw new Error("reservation failed");
    }

    expect(await roomStore.deleteQuotaScope(roomScope)).toMatchObject({
      status: "in-use",
      usage: { usedCount: 1 },
    });
    expect(await roomStore.getQuotaUsage(roomScope)).toBeDefined();

    await roomStore.applyEvent(
      {
        type: "released",
        reservationId: reserved.reservation.id,
        resourceId: asResourceId("resource-room"),
        workerId,
        bootId,
        operationId: operation("release-room"),
        at: 1,
      },
      1,
    );
    expect(await roomStore.deleteQuotaScope(roomScope)).toEqual({ status: "deleted" });
    expect(await roomStore.getQuotaUsage(roomScope)).toBeUndefined();
    expect(await roomStore.deleteQuotaScope(roomScope)).toEqual({ status: "not-found" });
    expect(
      await roomStore.reserve(
        { scopes: [serverScope, roomScope], sizeBytes: 1 },
        operation("reserve-after-delete"),
        2,
      ),
    ).toMatchObject({ status: "rejected", reason: "limit-not-configured" });
  });
});
