CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"transaction_id" uuid,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_transaction_id_journal_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."journal_transactions"("id") ON DELETE no action ON UPDATE no action;