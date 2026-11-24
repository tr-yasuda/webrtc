import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import {
  ReconciliationCapacityError,
  ReconciliationCursorMismatchError,
  ReconciliationJobNotFoundError,
  resolveBatchLimit,
  type ReconciliationBatchOptions,
  type ReconciliationBatchResult,
  type ReconciliationJob,
  type ReconciliationJobStatus,
  type Reservation,
  type ResolvedResourceStoreOptions,
  type WorkerStoppedEvent,
} from "../contract.js";
import {
  asBootId,
  asReservationId,
  asResourceId,
  asWorkerId,
  newReconciliationJobId,
  type BootId,
  type ReconciliationJobId,
  type ReservationId,
  type ResourceId,
  type WorkerId,
} from "../id.js";
import { confirmedResourceSize, reconciliationTargetSize } from "../reconciliation-size.js";
import { planWorkerStopForReservation } from "../transition.js";
import type { PostgresAuditLog } from "./audit.js";
import { toReconciliationJob, toReconciliationJobStatus, toReservation } from "./codec.js";
import type { ResourcesDatabase, ResourcesTransaction } from "./db.js";
import { releaseQuota, updateReservation } from "./operations.js";
import * as schema from "./schema.js";

type ReconciliationTargetRow = typeof schema.reconciliationTarget.$inferSelect;

type ReconciliationTargetOutcome =
  | { readonly kind: "reclaimed"; readonly reservationId: ReservationId }
  | { readonly kind: "isolated"; readonly reservationId: ReservationId }
  | { readonly kind: "unchanged"; readonly reservationId: ReservationId }
  | { readonly kind: "skipped"; readonly reservationId: ReservationId };

export class PostgresReconciliationStore {
  public constructor(
    private readonly db: ResourcesDatabase,
    private readonly options: ResolvedResourceStoreOptions,
    private readonly auditLog: PostgresAuditLog,
  ) {}

  public async start(event: WorkerStoppedEvent, now: number): Promise<ReconciliationJob> {
    return this.db.transaction((tx) => this.startInTransaction(tx, event, now));
  }

  public async startInTransaction(
    tx: ResourcesTransaction,
    event: WorkerStoppedEvent,
    now: number,
  ): Promise<ReconciliationJob> {
    await tx
      .insert(schema.workerBoot)
      .values({
        workerId: event.workerId,
        bootId: event.bootId,
        state: "stopped",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [boot] = await tx
      .select()
      .from(schema.workerBoot)
      .where(
        and(
          eq(schema.workerBoot.workerId, event.workerId),
          eq(schema.workerBoot.bootId, event.bootId),
        ),
      )
      .for("update");
    if (boot === undefined) {
      throw new Error("worker boot row is missing");
    }
    if (boot.jobId !== null) {
      const [existing] = await tx
        .select()
        .from(schema.reconciliationJob)
        .where(eq(schema.reconciliationJob.jobId, boot.jobId))
        .for("update");
      if (existing !== undefined) {
        return toReconciliationJob(existing);
      }
    }
    const [existingByBoot] = await tx
      .select()
      .from(schema.reconciliationJob)
      .where(
        and(
          eq(schema.reconciliationJob.workerId, event.workerId),
          eq(schema.reconciliationJob.bootId, event.bootId),
        ),
      )
      .for("update");
    if (existingByBoot !== undefined) {
      await tx
        .update(schema.workerBoot)
        .set({ jobId: existingByBoot.jobId, updatedAt: now })
        .where(
          and(
            eq(schema.workerBoot.workerId, event.workerId),
            eq(schema.workerBoot.bootId, event.bootId),
          ),
        );
      return toReconciliationJob(existingByBoot);
    }

    const confirmed = new Set(event.confirmedResourceIds);
    let confirmedBytes = 0;
    for (const resourceId of confirmed) {
      confirmedBytes += confirmedResourceSize(resourceId);
    }
    if (
      confirmed.size > this.options.maxConfirmedResourceIds ||
      confirmedBytes > this.options.maxConfirmedResourceBytes
    ) {
      throw new ReconciliationCapacityError("confirmed resource capacity exceeded");
    }

    const candidateRows = await tx
      .select()
      .from(schema.resourceReservation)
      .where(
        and(
          eq(schema.resourceReservation.workerId, event.workerId),
          eq(schema.resourceReservation.bootId, event.bootId),
          ne(schema.resourceReservation.state, "released"),
        ),
      )
      .orderBy(asc(schema.resourceReservation.id))
      .limit(this.options.maxReconciliationTargets + 1);
    if (candidateRows.length > this.options.maxReconciliationTargets) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }

    const targetSpecs = candidateRows.map((row) => {
      const resourceId = row.resourceId === null ? undefined : asResourceId(row.resourceId);
      return {
        reservationId: asReservationId(row.id),
        resourceId,
        confirmed: resourceId !== undefined && confirmed.has(resourceId),
        sizeBytes: reconciliationTargetSize(asReservationId(row.id), resourceId),
      };
    });
    const targetBytes = targetSpecs.reduce((total, target) => total + target.sizeBytes, 0);
    if (targetBytes > this.options.maxReconciliationTargetBytes) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }

    const jobId = newReconciliationJobId();
    const status: ReconciliationJobStatus = targetSpecs.length === 0 ? "completed" : "pending";
    await tx.insert(schema.reconciliationJob).values({
      jobId,
      workerId: event.workerId,
      bootId: event.bootId,
      status,
      lastTargetSeq: 0,
      targetCount: targetSpecs.length,
      targetBytes,
      createdAt: now,
      updatedAt: now,
    });
    const confirmedValues = [...confirmed].map((resourceId) => ({
      jobId,
      resourceId,
      sizeBytes: confirmedResourceSize(resourceId),
    }));
    for (let offset = 0; offset < confirmedValues.length; offset += 1_000) {
      await tx
        .insert(schema.reconciliationConfirmedResource)
        .values(confirmedValues.slice(offset, offset + 1_000));
    }
    for (let offset = 0; offset < targetSpecs.length; offset += 1_000) {
      await tx.insert(schema.reconciliationTarget).values(
        targetSpecs.slice(offset, offset + 1_000).map((target) => ({
          jobId,
          reservationId: target.reservationId,
          resourceId: target.resourceId ?? null,
          confirmed: target.confirmed,
          state: "pending",
          sizeBytes: target.sizeBytes,
        })),
      );
    }
    await tx
      .update(schema.workerBoot)
      .set({ jobId, updatedAt: now })
      .where(
        and(
          eq(schema.workerBoot.workerId, event.workerId),
          eq(schema.workerBoot.bootId, event.bootId),
        ),
      );

    await this.auditLog.write(tx, {
      eventType: "reconciliation-start",
      outcome: status === "completed" ? "completed" : "started",
      recordedAt: now,
      occurredAt: event.at,
      operationId: event.operationId,
      reconciliationJobId: jobId,
      workerId: event.workerId,
      bootId: event.bootId,
      scopes: [],
    });
    return {
      id: jobId,
      workerId: event.workerId,
      bootId: event.bootId,
      status,
      lastTargetSeq: 0,
      targetCount: targetSpecs.length,
      targetBytes,
      createdAt: now,
      updatedAt: now,
    } satisfies ReconciliationJob;
  }

  public async continue(
    jobId: ReconciliationJobId,
    options: ReconciliationBatchOptions,
    now: number,
  ): Promise<ReconciliationBatchResult> {
    return this.db.transaction(async (tx) => {
      const [initialJob] = await tx
        .select()
        .from(schema.reconciliationJob)
        .where(eq(schema.reconciliationJob.jobId, jobId));
      if (initialJob === undefined) {
        throw new ReconciliationJobNotFoundError(jobId);
      }
      if (options.cursor !== initialJob.lastTargetSeq) {
        throw new ReconciliationCursorMismatchError(initialJob.lastTargetSeq, options.cursor);
      }
      const initialStatus = toReconciliationJobStatus(initialJob.status);
      if (initialStatus === "completed" || initialStatus === "failed") {
        return {
          reclaimed: [],
          isolated: [],
          unchanged: [],
          hasMore: false,
          status: initialStatus,
        };
      }

      const limit = resolveBatchLimit(options.limit, this.options.reconciliationBatchSize);
      const selectedTargets = await tx
        .select()
        .from(schema.reconciliationTarget)
        .where(
          and(
            eq(schema.reconciliationTarget.jobId, jobId),
            eq(schema.reconciliationTarget.state, "pending"),
            gt(schema.reconciliationTarget.targetSeq, options.cursor),
          ),
        )
        .orderBy(asc(schema.reconciliationTarget.targetSeq))
        .limit(limit);
      const reservationIds = [...new Set(selectedTargets.map((target) => target.reservationId))];
      if (reservationIds.length > 0) {
        await tx
          .select()
          .from(schema.resourceReservation)
          .where(inArray(schema.resourceReservation.id, reservationIds))
          .orderBy(asc(schema.resourceReservation.id))
          .for("update");
      }

      const [job] = await tx
        .select()
        .from(schema.reconciliationJob)
        .where(eq(schema.reconciliationJob.jobId, jobId))
        .for("update");
      if (job === undefined) {
        throw new ReconciliationJobNotFoundError(jobId);
      }
      if (options.cursor !== job.lastTargetSeq) {
        throw new ReconciliationCursorMismatchError(job.lastTargetSeq, options.cursor);
      }
      const status = toReconciliationJobStatus(job.status);
      if (status === "completed" || status === "failed") {
        return {
          reclaimed: [],
          isolated: [],
          unchanged: [],
          hasMore: false,
          status,
        };
      }

      const freshTargets =
        selectedTargets.length === 0
          ? []
          : await tx
              .select()
              .from(schema.reconciliationTarget)
              .where(
                and(
                  eq(schema.reconciliationTarget.jobId, jobId),
                  inArray(
                    schema.reconciliationTarget.targetSeq,
                    selectedTargets.map((target) => target.targetSeq),
                  ),
                ),
              )
              .orderBy(asc(schema.reconciliationTarget.targetSeq));
      const reservationRows =
        reservationIds.length === 0
          ? []
          : await tx
              .select()
              .from(schema.resourceReservation)
              .where(inArray(schema.resourceReservation.id, reservationIds));
      const reservations = new Map(
        reservationRows.map((row) => [row.id, toReservation(row)] as const),
      );

      const reclaimed: ReservationId[] = [];
      const isolated: ReservationId[] = [];
      const unchanged: ReservationId[] = [];
      const jobWorkerId = asWorkerId(job.workerId);
      const jobBootId = asBootId(job.bootId);
      for (const target of freshTargets) {
        const reservation = reservations.get(target.reservationId);
        const targetResourceId =
          target.resourceId === null ? undefined : asResourceId(target.resourceId);
        const outcome = await this.applyTarget(
          tx,
          target,
          reservation,
          targetResourceId,
          jobId,
          jobWorkerId,
          jobBootId,
          now,
        );
        if (outcome.kind === "reclaimed") {
          reclaimed.push(outcome.reservationId);
        } else if (outcome.kind === "isolated") {
          isolated.push(outcome.reservationId);
        } else if (outcome.kind === "unchanged") {
          unchanged.push(outcome.reservationId);
        }
      }

      const lastTargetSeq =
        selectedTargets[selectedTargets.length - 1]?.targetSeq ?? options.cursor;
      const [remaining] = await tx
        .select({ targetSeq: schema.reconciliationTarget.targetSeq })
        .from(schema.reconciliationTarget)
        .where(
          and(
            eq(schema.reconciliationTarget.jobId, jobId),
            eq(schema.reconciliationTarget.state, "pending"),
            gt(schema.reconciliationTarget.targetSeq, lastTargetSeq),
          ),
        )
        .limit(1);
      const hasMore = remaining !== undefined;
      const nextStatus: ReconciliationJobStatus = hasMore ? "running" : "completed";
      await tx
        .update(schema.reconciliationJob)
        .set({
          lastTargetSeq,
          status: nextStatus,
          updatedAt: now,
        })
        .where(eq(schema.reconciliationJob.jobId, jobId));
      if (nextStatus === "completed") {
        await this.auditLog.write(tx, {
          eventType: "reconciliation-complete",
          outcome: "completed",
          recordedAt: now,
          occurredAt: now,
          reconciliationJobId: jobId,
          workerId: jobWorkerId,
          bootId: jobBootId,
          scopes: [],
        });
      }

      return {
        reclaimed,
        isolated,
        unchanged,
        ...(lastTargetSeq > options.cursor ? { nextCursor: lastTargetSeq } : {}),
        hasMore,
        status: nextStatus,
      };
    });
  }

  public async get(jobId: ReconciliationJobId): Promise<ReconciliationJob | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.reconciliationJob)
      .where(eq(schema.reconciliationJob.jobId, jobId))
      .limit(1);
    return row === undefined ? undefined : toReconciliationJob(row);
  }

  public async checkTargetCapacity(
    tx: ResourcesTransaction,
    reservationId: ReservationId,
    workerId: WorkerId,
    bootId: BootId,
    resourceId: ResourceId,
  ): Promise<boolean> {
    const [boot] = await tx
      .select()
      .from(schema.workerBoot)
      .where(and(eq(schema.workerBoot.workerId, workerId), eq(schema.workerBoot.bootId, bootId)))
      .for("update");
    if (boot?.jobId === null || boot?.jobId === undefined) {
      return true;
    }
    const [job] = await tx
      .select()
      .from(schema.reconciliationJob)
      .where(eq(schema.reconciliationJob.jobId, boot.jobId))
      .for("update");
    if (job === undefined || job.status === "failed") {
      return true;
    }
    const sizeBytes = reconciliationTargetSize(reservationId, resourceId);
    const [existing] = await tx
      .select()
      .from(schema.reconciliationTarget)
      .where(
        and(
          eq(schema.reconciliationTarget.jobId, boot.jobId),
          eq(schema.reconciliationTarget.reservationId, reservationId),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      if (existing.state !== "pending") {
        return true;
      }
      return (
        job.targetBytes - existing.sizeBytes + sizeBytes <=
        this.options.maxReconciliationTargetBytes
      );
    }
    return (
      job.targetCount + 1 <= this.options.maxReconciliationTargets &&
      job.targetBytes + sizeBytes <= this.options.maxReconciliationTargetBytes
    );
  }

  public async appendTarget(
    tx: ResourcesTransaction,
    reservation: Reservation,
    now: number,
  ): Promise<void> {
    if (
      reservation.workerId === undefined ||
      reservation.bootId === undefined ||
      reservation.resourceId === undefined
    ) {
      return;
    }
    const [boot] = await tx
      .select()
      .from(schema.workerBoot)
      .where(
        and(
          eq(schema.workerBoot.workerId, reservation.workerId),
          eq(schema.workerBoot.bootId, reservation.bootId),
        ),
      )
      .for("update");
    if (boot?.jobId === null || boot?.jobId === undefined) {
      return;
    }
    const [job] = await tx
      .select()
      .from(schema.reconciliationJob)
      .where(eq(schema.reconciliationJob.jobId, boot.jobId))
      .for("update");
    if (job === undefined || job.status === "failed") {
      return;
    }
    const [confirmedRow] = await tx
      .select({ resourceId: schema.reconciliationConfirmedResource.resourceId })
      .from(schema.reconciliationConfirmedResource)
      .where(
        and(
          eq(schema.reconciliationConfirmedResource.jobId, boot.jobId),
          eq(schema.reconciliationConfirmedResource.resourceId, reservation.resourceId),
        ),
      )
      .limit(1);
    const confirmed = confirmedRow !== undefined;
    const sizeBytes = reconciliationTargetSize(reservation.id, reservation.resourceId);
    const [existing] = await tx
      .select()
      .from(schema.reconciliationTarget)
      .where(
        and(
          eq(schema.reconciliationTarget.jobId, boot.jobId),
          eq(schema.reconciliationTarget.reservationId, reservation.id),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      if (existing.state !== "pending") {
        return;
      }
      const targetBytes = job.targetBytes - existing.sizeBytes + sizeBytes;
      if (targetBytes > this.options.maxReconciliationTargetBytes) {
        throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
      }
      await tx
        .update(schema.reconciliationTarget)
        .set({
          resourceId: reservation.resourceId,
          confirmed,
          sizeBytes,
        })
        .where(
          and(
            eq(schema.reconciliationTarget.jobId, boot.jobId),
            eq(schema.reconciliationTarget.targetSeq, existing.targetSeq),
          ),
        );
      await tx
        .update(schema.reconciliationJob)
        .set({
          status: job.status === "completed" ? "pending" : job.status,
          targetBytes,
          updatedAt: now,
        })
        .where(eq(schema.reconciliationJob.jobId, boot.jobId));
      return;
    }

    if (
      job.targetCount + 1 > this.options.maxReconciliationTargets ||
      job.targetBytes + sizeBytes > this.options.maxReconciliationTargetBytes
    ) {
      throw new ReconciliationCapacityError("reconciliation target capacity exceeded");
    }
    await tx.insert(schema.reconciliationTarget).values({
      jobId: boot.jobId,
      reservationId: reservation.id,
      resourceId: reservation.resourceId,
      confirmed,
      state: "pending",
      sizeBytes,
    });
    await tx
      .update(schema.reconciliationJob)
      .set({
        status: job.status === "completed" ? "pending" : job.status,
        targetCount: job.targetCount + 1,
        targetBytes: job.targetBytes + sizeBytes,
        updatedAt: now,
      })
      .where(eq(schema.reconciliationJob.jobId, boot.jobId));
  }

  private async applyTarget(
    tx: ResourcesTransaction,
    target: ReconciliationTargetRow,
    reservation: Reservation | undefined,
    targetResourceId: ResourceId | undefined,
    jobId: ReconciliationJobId,
    workerId: WorkerId,
    bootId: BootId,
    now: number,
  ): Promise<ReconciliationTargetOutcome> {
    const reservationId = asReservationId(target.reservationId);
    const skip = async (): Promise<ReconciliationTargetOutcome> => {
      await tx
        .update(schema.reconciliationTarget)
        .set({ state: "skipped", processedAt: now })
        .where(
          and(
            eq(schema.reconciliationTarget.jobId, target.jobId),
            eq(schema.reconciliationTarget.targetSeq, target.targetSeq),
          ),
        );
      return { kind: "skipped", reservationId };
    };

    if (reservation === undefined) {
      return skip();
    }
    if (
      reservation.workerId !== workerId ||
      reservation.bootId !== bootId ||
      (targetResourceId !== undefined && targetResourceId !== reservation.resourceId) ||
      (targetResourceId === undefined && reservation.resourceId !== undefined) ||
      reservation.state === "released" ||
      reservation.state === "isolated"
    ) {
      return skip();
    }

    const confirmed = new Set<ResourceId>();
    if (target.confirmed && targetResourceId !== undefined) {
      confirmed.add(targetResourceId);
    }
    const plan = planWorkerStopForReservation(reservation, confirmed, workerId, bootId, now);
    if (plan === undefined) {
      return skip();
    }

    if (plan.action === "release") {
      await releaseQuota(tx, reservation);
    }
    if (plan.next !== undefined && plan.action !== "unchanged") {
      await updateReservation(tx, plan.next);
    }
    await tx
      .update(schema.reconciliationTarget)
      .set({ state: "processed", processedAt: now })
      .where(
        and(
          eq(schema.reconciliationTarget.jobId, target.jobId),
          eq(schema.reconciliationTarget.targetSeq, target.targetSeq),
        ),
      );
    if (plan.action === "release") {
      await this.auditLog.write(tx, {
        eventType: "reconciliation-reclaimed",
        outcome: "applied",
        recordedAt: now,
        occurredAt: now,
        reservationId,
        reconciliationJobId: jobId,
        ...(reservation.resourceId === undefined ? {} : { resourceId: reservation.resourceId }),
        ...(reservation.workerId === undefined ? {} : { workerId: reservation.workerId }),
        ...(reservation.bootId === undefined ? {} : { bootId: reservation.bootId }),
        stateBefore: reservation.state,
        stateAfter: "released",
        sizeBytes: reservation.sizeBytes,
        scopes: reservation.scopes,
      });
      return { kind: "reclaimed", reservationId };
    }
    if (plan.action === "isolate") {
      await this.auditLog.write(tx, {
        eventType: "reconciliation-isolated",
        outcome: "applied",
        recordedAt: now,
        occurredAt: now,
        reservationId,
        reconciliationJobId: jobId,
        ...(reservation.resourceId === undefined ? {} : { resourceId: reservation.resourceId }),
        ...(reservation.workerId === undefined ? {} : { workerId: reservation.workerId }),
        ...(reservation.bootId === undefined ? {} : { bootId: reservation.bootId }),
        stateBefore: reservation.state,
        stateAfter: "isolated",
        sizeBytes: reservation.sizeBytes,
        scopes: reservation.scopes,
      });
      return { kind: "isolated", reservationId };
    }
    return { kind: "unchanged", reservationId };
  }
}
