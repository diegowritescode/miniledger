-- Sum-zero enforcement (ADR-005): every transaction's postings must net to zero.
-- A single-row CHECK cannot span rows, so the per-transaction invariant is a
-- constraint trigger. DEFERRABLE INITIALLY DEFERRED makes it evaluate at COMMIT,
-- so a multi-leg transaction may insert its legs one at a time (temporarily
-- unbalanced mid-transaction) and is validated only as a complete set at commit.
CREATE OR REPLACE FUNCTION assert_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (
    SELECT COALESCE(SUM(amount), 0)
    FROM postings
    WHERE transaction_id = NEW.transaction_id
  ) <> 0 THEN
    RAISE EXCEPTION 'transaction % is unbalanced: postings must sum to zero', NEW.transaction_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER postings_balanced
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_transaction_balanced();
--> statement-breakpoint
-- Append-only postings (ADR-005): history is immutable; corrections are new
-- compensating entries, never edits. Revoking from PUBLIC is defense in depth.
-- The runtime should connect as a dedicated least-privilege role that is NOT the
-- table owner (the owner bypasses these grants); provisioning that role is a
-- deployment-hardening step documented in docs/data-model.md.
REVOKE UPDATE, DELETE ON postings FROM PUBLIC;
--> statement-breakpoint
-- Backfill a materialized balance row for every existing account (ADR-006).
-- Idempotent so it is safe to apply from an empty database or to re-run.
INSERT INTO account_balances (account_id, balance)
SELECT id, 0 FROM accounts
ON CONFLICT (account_id) DO NOTHING;
