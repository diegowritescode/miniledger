# ADR-008: Tamper-evident audit — a per-account hash chain

- **Status:** Accepted (2026-07-14)
- **Date:** 2026-07-14
- How MiniLedger makes its append-only history **tamper-evident**, without serializing the ledger.

## Context

Append-only postings ([ADR-005](005-double-entry-model.md)) and `REVOKE UPDATE, DELETE`
([ADR-007](007-idempotency.md) references it) make history hard to change _through the application_.
But `REVOKE … FROM PUBLIC` does not bind the table **owner**, and a DBA, a migration, or a
compromised connection could still rewrite a posting's `amount` or `balance_after`. A ledger should
make such tampering **detectable after the fact**, not merely discouraged.

The constraint is that detection must not cost the concurrency that
[ADR-006](006-concurrency-safe-balances.md) exists to provide: transfers touching _different_
accounts must still run in parallel.

## Decision

Give **each account its own hash chain** over the postings that touch it. Every posting stores:

- `prev_hash` — the chain head of that account before this posting (`NULL` for the account's first),
- `hash` — `sha256(prev_hash ‖ transaction_id ‖ account_id ‖ amount ‖ balance_after)`,

and the account's current chain head is kept on `account_balances.chain_hash`, updated in the **same
locked write** that moves the balance ([ADR-006](006-concurrency-safe-balances.md)). Because a
transfer already holds each involved account's `account_balances` row under `SELECT … FOR UPDATE`,
the chain link is computed and advanced **under that existing lock** — no new synchronization, and
postings on one account are serialized exactly as their balance updates already are.

A **read-only verifier** (the `audit` module, [ADR-001](001-architecture-style.md)) recomputes an
account's chain from its postings in insertion order (a monotonic `seq`) and checks:

1. **Chain integrity** — each recomputed `hash` matches the stored one and each `prev_hash` matches
   the predecessor's `hash`, up to `account_balances.chain_hash`.
2. **Reconciliation** — `account_balances.balance == SUM(postings.amount) == the last
balance_after` for the account ([ADR-006](006-concurrency-safe-balances.md)).
3. **Conservation** — `SUM(amount)` over all postings in a currency is zero
   ([ADR-005](005-double-entry-model.md)).

Any after-the-fact edit to a posting's `amount` or `balance_after` breaks its `hash` and every hash
after it on that account, so the verifier flags exactly where the chain diverges.

### Why per-account and not a single global chain

A **global** chain — every posting linking to the one global previous posting — would force _every_
transfer to read and advance the same chain head, **serializing the entire ledger** and destroying
the parallelism of [ADR-006](006-concurrency-safe-balances.md). A per-account chain localizes the
dependency to the accounts a transfer already locks, so unrelated transfers stay concurrent. The
cost is that there is no single global hash; conservation across accounts is instead checked by the
sum-zero property, which is already a global invariant.

## Consequences

### Positive

- **Tamper-evidence beyond `REVOKE`** — even an owner-level edit is detectable, because it must
  also forge every subsequent hash on the account, which requires re-deriving from data the verifier
  independently recomputes.
- **No concurrency cost** — the chain advances under the balance lock the transfer already holds;
  independent accounts are unaffected.
- **Three-way self-check** — chain + reconciliation + conservation give overlapping guarantees.

### Negative / costs

- **Not cryptographically signed** — a hash chain proves _internal consistency_, not authorship; an
  attacker who rewrites a posting _and_ recomputes the whole tail of that account's chain (and the
  `chain_hash`) would pass verification. Signing (a KMS/Vault-held key) would close that gap and is
  a documented later ring; it was dropped here with Vault ([ADR-003](003-persistence-and-orm.md)
  context) to avoid key management this scale does not yet need.
- **Verification is O(postings) per account** — fine for on-demand audit; a cached/rolling
  verification is a later optimization.
- **`balance_after` and the chain must stay in step with the balance** — all three are written in
  the same locked transaction, and the verifier is what catches any drift.

## Alternatives considered

- **A single global hash chain** — rejected: it serializes every transfer through one chain head,
  the opposite of [ADR-006](006-concurrency-safe-balances.md).
- **A Merkle tree per period** — rejected as premature: more machinery than on-demand per-account
  verification needs, and it does not fit the streaming, per-account write path.
- **Cryptographically signed postings (KMS/Vault)** — deferred: real non-repudiation, but it adds
  key management (the very reason Vault was dropped for MiniLedger); the hash chain is the
  proportionate first step and the signing upgrade is additive.
- **An external, append-only audit log (e.g. a separate service/WORM store)** — rejected here: it
  cannot be written **atomically** with the posting, reintroducing a consistency gap; the chain
  lives in the same transaction as the money.
