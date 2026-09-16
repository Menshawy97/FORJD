# ADR-038: Audit remediation pass (2026-09)

**Status:** Accepted
**Date:** 2026-09-16

## Context

`docs/reviews/2026-09-10-whole-repo-audit.md` (17 of 17 scoped audits, completed 2026-09-12) was
a multi-agent, read-only review of the whole repository. It found 3 CRITICAL issues (no account
deletion, AI consent not enforced on InBody scan uploads, finished workouts silently lost after
sync failures), a run of HIGH and MEDIUM findings across privacy, offline sync, testing gaps and
CI enforcement, and a handful of LOW documentation/config issues.

`docs/product/audit-remediation-plan.md` is the executable record of the response: 29 slices
(R1–R29), each with its own RED/GREEN plan, sequenced so the highest-severity fixes (account
deletion, AI consent, sync loss) landed first. This ADR does not re-list all 29 — the plan doc
is the detailed record — but records the shape of the work and the one lesson worth keeping
independent of any single slice: **three separate rules in this repository were claimed, in a
doc or in a script's own header comment, without anything actually enforcing them.** All three
surfaced during this audit, and closing that specific gap is what this ADR is for.

## Decision

Adopt the remediation plan's slices as the record of what changed, and record here — durably,
outside the plan doc's own slice-by-slice detail — the pattern common to three of its findings:

### 1. Rule 15 was claimed in the conformance script's own header, unenforced (fixed in R12)

`CLAUDE.md` rule 15 — health data never reaches an analytics or advertising SDK — and
`scripts/ci/check-architecture-conformance.sh`'s own header comment both stated the rule. No
grep in the script actually checked for it. A PR could route a health observation straight into
an analytics SDK call and the "enforced, not just stated" conformance gate would stay green,
silently agreeing that nothing was wrong. R12 added the missing grep.

### 2. The domain-purity check was defeated by a quote-character mismatch (fixed in R12)

The same script's rules 1–2 guard (`packages/domain` must not import UI or provider SDKs)
matched only `from '...'` — single-quoted imports. `packages/domain` is mostly double-quoted,
and Prettier's quote rule was not enforced in CI, so `import { createClient } from
"@supabase/supabase-js"` in a domain file passed the gate outright. The allow-list of modules it
searched for was also incomplete (missing `openai`, `drizzle-orm`, `pg`, `@sentry/*`, `axios`).
R12 replaced the pattern with a quote-agnostic one and broadened the module list.

### 3. RLS was documented as existing defense-in-depth, and does not exist (corrected in this slice, R29)

ADR-008 and `docs/architecture/security.md` both stated that row-level security was enabled on
user-owned tables as a second authorization layer beneath NestJS guards. It is enabled on no
table, and — the detail that makes implementing it now mostly theatre rather than a real
improvement — `apps/api`'s `DatabaseModule` connects to Postgres directly via `pg.Pool` using
`DATABASE_URL`'s configured role, not through Supabase's PostgREST/anon-key path that RLS
policies actually gate. A direct connection using that role bypasses RLS regardless of whether
policies exist. Unlike the two findings above, **this is not a fix that adds enforcement** — the
plan's own recommendation, adopted here, is to correct the documents rather than build RLS,
since a bypassing role makes the SQL-level rule unenforceable in practice no matter how it's
written. `CLAUDE.md` rule 12 ("RLS is defense-in-depth... a rule that exists only in SQL is a
rule you can't unit test") is not violated by this — NestJS guards being the sole layer is
exactly what rule 12 asks for. The violation was the documentation claiming a second layer that
was never actually there. ADR-008 and `security.md` are corrected as part of this slice; see
those files for the specific line-level corrections.

Two smaller, non-pattern items closed in the same slice: `packages/domain/src/
training-calculations.ts` implemented a `reps - 1` Epley variant that disagreed with its own
docblock and read about 3 percent low — the user chose the standard, published formula, both
curves having been shown first since this changes numbers real athletes see (see this file's
docblock and `training-calculations.spec.ts` for the corrected formula and its test coverage);
and `docs/architecture/analytics.md` gained a note explaining why CLAUDE.md rule 9 (never mutate
an analytics aggregate) currently has no referent under ADR-029's compute-on-read design, so a
future reader isn't confused by a rule with nothing to apply to today.

## Rationale

The three items above are not independent bugs; they are the same failure mode in three places:
**a rule stated in a doc, or in a script's own comment, is not the same as a rule actually
enforced.** A conformance script that claims to check something and doesn't is worse than no
script at all, because it produces false confidence exactly where the project's own
documentation says the confidence should be highest ("Enforced, not just stated" is `CLAUDE.md`'s
own section header). An ADR that claims a defense-in-depth layer that was never built produces
the same false confidence one layer up, in the design record instead of the CI gate.

## Consequences

- The conformance script now greps for rule 15's health-data-to-analytics path and matches
  imports regardless of quote style, with a broader module list (R12).
- ADR-008 and `docs/architecture/security.md` now state plainly that NestJS guards are the only
  authorization layer, with no RLS defense-in-depth claim standing unqualified.
- `packages/domain/src/training-calculations.ts` computes standard Epley; the ~3 percent higher
  numbers this produces for existing users are a disclosed behavior change, not a silent one —
  see the R29 pull request for the before/after numbers and the fixtures that changed with it.
- `docs/architecture/analytics.md` documents rule 9's current lack of a referent so it isn't
  mistaken for an unenforced rule the next time someone reads `CLAUDE.md` top to bottom.
- The durable habit this ADR is meant to leave behind: when a script or a doc claims to enforce
  or guarantee something, that claim gets the same scrutiny as the code it's describing —
  ideally a test that would fail if the claim stopped being true, the same discipline
  `CLAUDE.md` rule 12 already asks for explicitly.

## Related

- [`../reviews/2026-09-10-whole-repo-audit.md`](../reviews/2026-09-10-whole-repo-audit.md) — the
  audit this remediation pass responds to.
- [`../product/audit-remediation-plan.md`](../product/audit-remediation-plan.md) — the
  slice-by-slice executable record (R1–R29).
- [ADR-008](./ADR-008-auth-storage-provider-abstraction.md) — corrected by this pass.
- [ADR-029](./ADR-029-progress-analytics-computed-on-read.md) — the design this pass's rule-9
  note in `docs/architecture/analytics.md` explains.
