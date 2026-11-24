CREATE TABLE "rate_limit_entry" (
	"table_key" text NOT NULL,
	"entry_key" text NOT NULL,
	"window_started_at" bigint NOT NULL,
	"count" bigint NOT NULL,
	"bytes" bigint NOT NULL,
	"last_used_at" bigint NOT NULL,
	"size_bytes" bigint NOT NULL,
	CONSTRAINT "rate_limit_entry_table_key_entry_key_pk" PRIMARY KEY("table_key","entry_key")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_global" (
	"table_key" text PRIMARY KEY NOT NULL,
	"window_started_at" bigint NOT NULL,
	"count" bigint NOT NULL,
	"bytes" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_operation" (
	"operation_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"result" jsonb NOT NULL,
	"occurred_at" bigint NOT NULL,
	"recorded_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_quota" (
	"scope_kind" text NOT NULL,
	"scope_key" text NOT NULL,
	"max_count" bigint NOT NULL,
	"max_bytes" bigint NOT NULL,
	"used_count" bigint DEFAULT 0 NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "resource_quota_scope_kind_scope_key_pk" PRIMARY KEY("scope_kind","scope_key")
);
--> statement-breakpoint
CREATE TABLE "resource_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"size_bytes" bigint NOT NULL,
	"resource_id" text,
	"worker_id" text,
	"boot_id" text,
	"version" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"expires_at" bigint
);
--> statement-breakpoint
CREATE INDEX "resource_operation_recorded_at_idx" ON "resource_operation" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "resource_reservation_worker_idx" ON "resource_reservation" USING btree ("worker_id","boot_id");--> statement-breakpoint
CREATE INDEX "resource_reservation_state_idx" ON "resource_reservation" USING btree ("state");--> statement-breakpoint
CREATE INDEX "resource_reservation_released_updated_idx" ON "resource_reservation" USING btree ("state","updated_at");