CREATE TABLE "resource_audit_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"recorded_at" bigint NOT NULL,
	"occurred_at" bigint NOT NULL,
	"event_type" text NOT NULL,
	"outcome" text NOT NULL,
	"operation_id" text,
	"reservation_id" text,
	"resource_id" text,
	"worker_id" text,
	"boot_id" text,
	"reconciliation_job_id" text,
	"state_before" text,
	"state_after" text,
	"size_bytes" bigint,
	"max_count_before" bigint,
	"max_count_after" bigint,
	"max_bytes_before" bigint,
	"max_bytes_after" bigint
);
--> statement-breakpoint
CREATE TABLE "resource_audit_scope" (
	"event_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_ref" text NOT NULL,
	"key_version" integer NOT NULL,
	CONSTRAINT "resource_audit_scope_event_id_scope_kind_scope_ref_pk" PRIMARY KEY("event_id","scope_kind","scope_ref")
);
--> statement-breakpoint
CREATE INDEX "resource_audit_event_recorded_idx" ON "resource_audit_event" USING btree ("recorded_at","event_id");--> statement-breakpoint
CREATE INDEX "resource_audit_event_type_recorded_idx" ON "resource_audit_event" USING btree ("event_type","recorded_at");--> statement-breakpoint
CREATE INDEX "resource_audit_scope_lookup_idx" ON "resource_audit_scope" USING btree ("scope_kind","scope_ref","event_id");