import { and, eq, sql } from "drizzle-orm";
import { compareQuotaScopes, type QuotaScope, type Reservation } from "../contract.js";
import type { OperationId } from "../id.js";
import type { ResourcesTransaction } from "./db.js";
import * as schema from "./schema.js";

export type QuotaRow = typeof schema.resourceQuota.$inferSelect;
type OperationRow = typeof schema.resourceOperation.$inferSelect;

const PENDING_RESULT: { readonly status: "pending" } = { status: "pending" };

// 同じ操作IDの同時再送を直列化する。先行トランザクションの INSERT が確定するまで待ち、
// その後 FOR UPDATE で結果を読み出す。未完了の結果は pending として区別する。
export type LockedOperation =
  | { readonly kind: "owned"; readonly stored: OperationRow }
  | { readonly kind: "existing"; readonly stored: OperationRow }
  | { readonly kind: "capacity-exhausted" };

export async function lockOperation(
  tx: ResourcesTransaction,
  operationId: OperationId,
  kind: "reserve" | "event",
  occurredAt: number,
  recordedAt: number,
  capacityExceeded: boolean,
): Promise<LockedOperation> {
  const [existing] = await tx
    .select()
    .from(schema.resourceOperation)
    .where(eq(schema.resourceOperation.operationId, operationId))
    .limit(1);
  if (existing !== undefined) {
    if ((existing.result as { status?: string }).status === "pending") {
      throw new Error("operation result is incomplete");
    }
    return { kind: "existing", stored: existing };
  }
  if (capacityExceeded) {
    return { kind: "capacity-exhausted" };
  }

  const inserted = await tx
    .insert(schema.resourceOperation)
    .values({
      operationId,
      kind,
      result: PENDING_RESULT,
      occurredAt,
      recordedAt,
    })
    .onConflictDoNothing()
    .returning({ operationId: schema.resourceOperation.operationId });
  const [stored] = await tx
    .select()
    .from(schema.resourceOperation)
    .where(eq(schema.resourceOperation.operationId, operationId))
    .for("update");
  if (stored === undefined) {
    throw new Error("operation row is missing");
  }
  if (!inserted.length && (stored.result as { status?: string }).status === "pending") {
    throw new Error("operation result is incomplete");
  }
  return { kind: inserted.length > 0 ? "owned" : "existing", stored };
}

export async function completeOperation<T>(
  tx: ResourcesTransaction,
  operationId: OperationId,
  result: T,
): Promise<T> {
  const updated = await tx
    .update(schema.resourceOperation)
    .set({ result })
    .where(eq(schema.resourceOperation.operationId, operationId))
    .returning({ operationId: schema.resourceOperation.operationId });
  if (updated.length === 0) {
    throw new Error("operation row is missing");
  }
  return result;
}

export async function lockQuota(
  tx: ResourcesTransaction,
  scope: QuotaScope,
): Promise<QuotaRow | undefined> {
  const [row] = await tx
    .select()
    .from(schema.resourceQuota)
    .where(
      and(
        eq(schema.resourceQuota.scopeKind, scope.kind),
        eq(schema.resourceQuota.scopeKey, scope.key),
      ),
    )
    .for("update");
  return row;
}

// quota 行の INSERT と DELETE が競合すると変更前値を失うため、スコープ単位で直列化する。
export async function lockQuotaScope(tx: ResourcesTransaction, scope: QuotaScope): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${scope.kind}:${scope.key}`})::bigint)`,
  );
}

export async function updateReservation(
  tx: ResourcesTransaction,
  reservation: Reservation,
): Promise<void> {
  await tx
    .update(schema.resourceReservation)
    .set({
      state: reservation.state,
      resourceId: reservation.resourceId ?? null,
      workerId: reservation.workerId ?? null,
      bootId: reservation.bootId ?? null,
      version: reservation.version,
      updatedAt: reservation.updatedAt,
      expiresAt: reservation.expiresAt ?? null,
    })
    .where(eq(schema.resourceReservation.id, reservation.id));
}

export async function releaseQuota(
  tx: ResourcesTransaction,
  reservation: Reservation,
): Promise<void> {
  const scopes = reservation.scopes.toSorted(compareQuotaScopes);
  for (const scope of scopes) {
    const quota = await lockQuota(tx, scope);
    if (quota === undefined) {
      throw new Error(`quota is missing for ${scope.kind}:${scope.key}`);
    }
    if (quota.usedCount < 1 || quota.usedBytes < reservation.sizeBytes) {
      throw new Error(`quota accounting is inconsistent for ${scope.kind}:${scope.key}`);
    }
    await tx
      .update(schema.resourceQuota)
      .set({
        usedCount: quota.usedCount - 1,
        usedBytes: quota.usedBytes - reservation.sizeBytes,
      })
      .where(
        and(
          eq(schema.resourceQuota.scopeKind, quota.scopeKind),
          eq(schema.resourceQuota.scopeKey, quota.scopeKey),
        ),
      );
  }
}
