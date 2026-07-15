ALTER TABLE "accounts" ADD COLUMN "owner_id" text;--> statement-breakpoint
CREATE INDEX "accounts_owner_id_idx" ON "accounts" USING btree ("owner_id");