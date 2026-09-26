# Lane 2 — Security and authorization (8.5E re-run, 2026-09-26, at 445fcf0)

## Previous findings

| ID | Claim | Status at 445fcf0 |
|---|---|---|
| L2-1 | CORS reflects any origin when `ALLOWED_WEB_ORIGINS` is unset | **Unchanged, low, accepted.** `apps/api/src/cors.ts:26-42` untouched by 8.5D; the production allowlist is set. |
| L2-2 | Forgot-password / resend-confirmation throttled per IP only | **Closed by a documented decision (S11)**, as the finding allowed: `docs/architecture/security.md` records reliance on Supabase Auth's per-address limit (one per 60 s) plus its per-project hourly cap, with a citation. |
| L2-3 | WHOOP OAuth `state` may not be invalidated after use | **Fixed (S11).** `whoop-connection.repository.ts:121-135` `consumeOAuthState` clears the state in the same `UPDATE … RETURNING` that reads it; `whoop-callback.service.ts:58-63` calls it before any step that can fail. Covered by repository specs. |
| L12-1 | Deploy/snapshot workflows use mutable action tags | **Fixed (S11).** Every `uses:` in `deploy-api.yml` and `leaderboard-snapshot.yml` is SHA-pinned; the conformance check now fails on any unpinned `uses:` and has fixture cases. |
| L12-2 | No security headers on getforjd.com | **Fixed and live (S11).** `apps/web/public/_headers` and the Astro CSP meta tag (`src/lib/security.ts`). `curl -sI https://getforjd.com/` on 2026-09-26 returns HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Permissions-Policy`, `Referrer-Policy`, `nosniff`. |

## New findings

**None** at any severity introduced by 8.5D in this lane's scope.

Checked specifically and sound:
- **WHOOP OAuth end to end:** `status`/`authorize`/`sync`/`disconnect` still behind `JwtAuthGuard`; `callback` and `webhook` public by design with `state` and HMAC as their identity checks; `authorize` still requires health-data consent (ADR-043); `consumeOAuthState` is the only reader of `oauthState` and always clears it.
- **S9 InBody error path** (`openai-vision.provider.ts:90-97`): only the vendor error text is logged; no image bytes, extracted values or user identifiers (rule 15). The client gets a fixed message.
- **S3 idempotent log id** (`nutrition.repository.ts:652-702`): the client id is the primary key; a collision with another user's row throws a generic `ConflictException` without revealing it. No IDOR.
- **S4 export runs** (`account-export.service.ts:135-146`): the run read is keyed by the user's own session ids, scoped by construction.
- **S6 leaderboard cache:** only totals are cached; membership, location, names, photos and the public flag are read live per request (ADR-054); private profiles withhold name and photo.
- **CI pinning enforcement** is real, with passing and failing fixtures.

## Unconfirmed
- `ci.yml` has no top-level `permissions:` block (the deploy and snapshot workflows scope theirs). Predates 8.5D; `ci.yml` touches no credentials; depends on the repository's default token permission, not checked.
- Zone-level HSTS and the live 429 path on getforjd.com were not re-tested (out of a read-only remit beyond `curl -I`).

## Checked and clean
Object-level scoping (body, nutrition, workouts, sessions, programs, the S4 export and S6 leaderboard reads); uniform 404 on private athlete profiles; JWT re-verified per request; DOB gate (ADR-042); WHOOP webhook timing-safe HMAC; AI consent before InBody extract/confirm; bounded health series; global throttle 60/min with tighter overrides; no secrets in mobile source; no concatenated SQL; errors do not leak existence.

**Not re-read** (untouched by 8.5D, no open finding): WHOOP callback/webhook handler bodies, `progress.service.ts`, `avatar-upload.service.ts` in full, `apps/web` client code beyond the CSP and headers files.
