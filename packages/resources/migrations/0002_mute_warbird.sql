CREATE TABLE "reconciliation_confirmed_resource" (
	"job_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	CONSTRAINT "reconciliation_confirmed_resource_job_id_resource_id_pk" PRIMARY KEY("job_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_job" (
	"job_id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"boot_id" text NOT NULL,
	"status" text NOT NULL,
	"last_target_seq" bigint DEFAULT 0 NOT NULL,
	"target_count" bigint DEFAULT 0 NOT NULL,
	"target_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "reconciliation_target" (
	"job_id" text NOT NULL,
	"target_seq" bigserial NOT NULL,
	"reservation_id" text NOT NULL,
	"resource_id" text,
	"confirmed" boolean NOT NULL,
	"state" text NOT NULL,
	"processed_at" bigint,
	"size_bytes" bigint NOT NULL,
	CONSTRAINT "reconciliation_target_job_id_target_seq_pk" PRIMARY KEY("job_id","target_seq")
);
--> statement-breakpoint
CREATE TABLE "worker_boot" (
	"worker_id" text NOT NULL,
	"boot_id" text NOT NULL,
	"state" text NOT NULL,
	"job_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "worker_boot_worker_id_boot_id_pk" PRIMARY KEY("worker_id","boot_id")
);
--> statement-breakpoint
CREATE INDEX "reconciliation_confirmed_job_idx" ON "reconciliation_confirmed_resource" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_job_worker_boot_idx" ON "reconciliation_job" USING btree ("worker_id","boot_id");--> statement-breakpoint
CREATE INDEX "reconciliation_job_status_updated_idx" ON "reconciliation_job" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_target_job_reservation_idx" ON "reconciliation_target" USING btree ("job_id","reservation_id");--> statement-breakpoint
CREATE INDEX "reconciliation_target_pending_idx" ON "reconciliation_target" USING btree ("job_id","state","target_seq");--> statement-breakpoint
CREATE INDEX "worker_boot_job_idx" ON "worker_boot" USING btree ("job_id");