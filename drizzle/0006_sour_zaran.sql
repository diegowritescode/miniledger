ALTER TABLE "postings" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "postings_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "account_balances" ADD COLUMN "chain_hash" text;