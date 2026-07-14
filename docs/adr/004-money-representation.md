# ADR-004: Money representation — signed integer minor units

- **Status:** Accepted (2026-07-13)
- **Date:** 2026-07-13
- The value object every posting, balance, and constraint in the ledger is built on.

## Context

A ledger's single most damaging bug class is **money that does not add up**. Any representation
that admits rounding error, silent precision loss, or ambiguous units is disqualifying — the
sum-zero invariant ([ADR-005](005-double-entry-model.md)) and the balance reconciliation
([ADR-006](006-concurrency-safe-balances.md)) are only meaningful if arithmetic is **exact**.

Two forces shape the choice: exactness (no floating-point drift, ever) and a compact, indexable,
constraint-friendly storage form the database can reason about in `CHECK`s and the deferred
sum-zero trigger. A monetary amount also carries a **currency**; comparing or summing amounts of
different currencies is a domain error, not an arithmetic one.

## Decision

Represent money as a **signed integer number of minor units**, stored in Postgres as **`bigint`**,
wrapped in a `Money` value object composed with a `Currency` value object. **Floating point is
never used for monetary values, anywhere.**

- **Minor units.** An amount is the count of the currency's smallest indivisible unit — cents for
  USD/EUR, so `$12.34` is `1234`. No fractional minor units exist, so integer arithmetic is exact
  and total.
- **Signed encoding = debit/credit.** A posting's `amount` is **signed**: a **debit is positive**,
  a **credit is negative**. This is the compact on-disk form; a transaction balances exactly when
  its postings' signed amounts sum to zero (`SUM(amount) = 0`). The debit/credit *vocabulary* is
  preserved in the domain model, the API, and `docs/data-model.md`, mapped from the sign — the
  database stores one signed `bigint`, the reader sees debit and credit.
- **`Currency` value object.** Each account and each transaction fixes a currency (ISO 4217 code
  plus its minor-unit scale). `Money` arithmetic (`add`, `negate`, `sum`) is defined **only within
  a single currency**; mixing currencies is rejected in the constructor/combinators as a domain
  error. **One currency per transaction** — every posting in a `JournalTransaction` shares it.
- **Cross-currency FX is out of scope**, deferred to a later ring. When it lands, an FX transfer
  will be modeled as balanced legs per currency through an FX/settlement account, not by summing
  across currencies — so this decision is forward-compatible, not a dead end.
- **Marshalling.** `pg` returns `bigint` columns as strings; the `Money` mapper converts at the
  row↔domain boundary so the domain sees a JS **`bigint`** ([ADR-003](003-persistence-and-orm.md)).
  JS `number` (IEEE-754 double, safe only to 2^53) is never used to hold an amount.

## Consequences

### Positive

- **Exact arithmetic by construction** — integer addition cannot round, so sum-zero and
  reconciliation are provable, not probabilistic.
- **Constraint- and index-friendly** — `bigint` supports the row-level `CHECK (amount <> 0)`, the
  deferred `SUM(amount) = 0` trigger, and ordered/aggregated balance queries directly in SQL.
- **Compact and unambiguous** — one signed column per posting captures both magnitude and
  direction; the debit/credit view is a presentation mapping, not extra storage.
- **A single choke point** — all money flows through `Money`/`Currency`, so the "never a float"
  and "never mix currencies" rules are enforced in one tested place.

### Negative / costs

- **`bigint` ergonomics** — JS `bigint` needs deliberate handling at DB and JSON boundaries (no
  implicit `number` coercion, string in JSON). Contained in the `Money` VO and its mappers.
- **Minor-unit scale is per-currency knowledge** — currencies with 0 or 3 decimal places (JPY,
  BHD) must carry the correct scale in `Currency`; a hardcoded "×100" would be wrong. Handled by
  the VO, not by callers.
- **Whole-minor-unit only** — fractional-cent amounts (some interest/FX intermediate results)
  are not representable and are explicitly out of scope until the FX ring.

## Alternatives considered

- **Floating point (`float`/`double`, JS `number`)** — rejected outright: IEEE-754 cannot
  represent most decimal fractions exactly, so sums drift and money is silently lost or created.
  Unacceptable for a ledger; this is the canonical mistake the ADR exists to prevent.
- **Postgres `numeric`/`decimal`** — considered and sound (arbitrary precision, exact). Deferred:
  for whole-minor-unit currencies, `bigint` is exact, simpler, faster to aggregate/index, and
  needs no scale/precision tuning. `numeric` becomes the natural upgrade if fractional minor
  units ever enter scope (e.g. FX), and this ADR would be revisited then.
- **Separate non-negative `debit` and `credit` columns** — considered; rejected as the storage
  form. It doubles the columns and complicates the sum-zero check, whereas one signed `bigint` is
  the compact canonical encoding. The debit/credit distinction is retained where it belongs — in
  the domain and API vocabulary, derived from the sign.
- **A money string / integer-major-plus-cents pair** — rejected: parsing and composite arithmetic
  reintroduce exactly the precision and edge-case risks a single integer eliminates.
