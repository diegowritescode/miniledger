INSERT INTO "accounts" ("type", "currency", "overdraft_floor", "handle")
SELECT 'system', 'USD', NULL, '@world'
WHERE NOT EXISTS (SELECT 1 FROM "accounts" WHERE "handle" = '@world' AND "currency" = 'USD');
--> statement-breakpoint
INSERT INTO "accounts" ("type", "currency", "overdraft_floor", "handle")
SELECT 'system', 'EUR', NULL, '@world'
WHERE NOT EXISTS (SELECT 1 FROM "accounts" WHERE "handle" = '@world' AND "currency" = 'EUR');
--> statement-breakpoint
INSERT INTO "accounts" ("type", "currency", "overdraft_floor", "handle")
SELECT 'system', 'JPY', NULL, '@world'
WHERE NOT EXISTS (SELECT 1 FROM "accounts" WHERE "handle" = '@world' AND "currency" = 'JPY');
