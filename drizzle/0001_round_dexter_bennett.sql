CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"currency" text NOT NULL,
	"overdraft_floor" bigint,
	"handle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('user', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_handle_currency_key" ON "accounts" USING btree ("handle","currency") WHERE "accounts"."handle" is not null;