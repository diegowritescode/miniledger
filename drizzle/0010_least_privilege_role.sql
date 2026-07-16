-- Least-privilege runtime role (ADR-011). The application connects as
-- `miniledger_app`; DDL migrations run as the owner via MIGRATION_DATABASE_URL.
-- This is what makes the append-only REVOKE in 0004 bind at runtime: a non-owner
-- role with no UPDATE/DELETE on `postings` cannot rewrite recorded history.
--
-- Idempotent and env-uniform. Locally/CI a single owner role is used, so the
-- CREATE ROLE branch provisions `miniledger_app` (NOLOGIN, unused). In production
-- the deployer pre-creates the role WITH LOGIN PASSWORD out-of-band, so no secret
-- ever lives in a migration; this migration only (re)applies the grants.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'miniledger_app') THEN
    CREATE ROLE miniledger_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO miniledger_app;

-- Append-only ledger history: SELECT + INSERT only. No UPDATE/DELETE.
REVOKE ALL ON postings, journal_transactions FROM miniledger_app;
GRANT SELECT, INSERT ON postings, journal_transactions TO miniledger_app;

-- Accounts are written once on open and never mutated.
REVOKE ALL ON accounts FROM miniledger_app;
GRANT SELECT, INSERT ON accounts TO miniledger_app;

-- Mutable state: materialized balances (also locked FOR UPDATE, which needs
-- UPDATE), idempotency bookkeeping, and the outbox (published_at on relay).
REVOKE ALL ON account_balances, idempotency_keys, outbox FROM miniledger_app;
GRANT SELECT, INSERT, UPDATE ON account_balances, idempotency_keys, outbox TO miniledger_app;

-- Identity/serial sequences backing the above inserts.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO miniledger_app;
