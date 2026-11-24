ALTER TABLE "rate_limit_global" ADD COLUMN "entries" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_limit_global" ADD COLUMN "entry_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "rate_limit_entry_expiry_idx" ON "rate_limit_entry" USING btree ("table_key","last_used_at","window_started_at");