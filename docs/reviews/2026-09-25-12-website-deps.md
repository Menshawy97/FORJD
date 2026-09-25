# Lane 12 — Website and dependencies (2026-09-25, at b1f006a)

### L12-1 — The two credentialed workflows use mutable action tags
- **Severity:** medium · **Where:** `.github/workflows/deploy-api.yml:61,65,69,79,84`, `.github/workflows/leaderboard-snapshot.yml:72,74,78,84,89`
- **Scenario:** `ci.yml` pins every action by commit SHA; the deploy and snapshot workflows (with `id-token: write`, Secret Manager access and a production deploy) use `@v4` / `@v2` tags. A repointed tag would run with GCP credentials.
- **Suggested fix:** pin to the SHAs `ci.yml` already uses, plus SHAs for `google-github-actions/auth` and `setup-gcloud`.

### L12-2 — No security headers on getforjd.com
- **Severity:** medium · **Where:** `apps/web` has no `public/_headers`; `astro.config.mjs` sets none. Live `curl -I https://getforjd.com/` (2026-09-25): only `x-content-type-options` and `referrer-policy`; no CSP, HSTS, `X-Frame-Options`, `Permissions-Policy`.
- **Scenario:** the site can be framed (clickjacking the waitlist form); no CSP defence in depth.
- **Suggested fix:** `apps/web/public/_headers` with HSTS, `X-Frame-Options: DENY`, a CSP allowing self + `challenges.cloudflare.com`, and a restrictive `Permissions-Policy`. (HSTS might be set at the Cloudflare zone; not visible in the response.)

### L12-3 — Expo packages a few patches behind SDK 57's expected versions
- **Severity:** low · **Where:** `apps/mobile/package.json`
- **Scenario:** `npx expo install --check`: ~22 `expo-*` packages behind (e.g. `expo` 57.0.20 vs ~57.0.25, `expo-router` 57.0.19 vs ~57.0.23). Patch level only.
- **Suggested fix:** `npx expo install --fix`, then an export and a device load (AGENTS.md's bar).

## Checked and clean
`pnpm audit --prod`: no known vulnerabilities. CORS (see L2-1, production allowlist set). Waitlist: Zod bounds, Turnstile before storage, constant 202, 5/10 min throttle, client fails closed; form disables on submit and resets the single-use token. `ci.yml` SHA pinning and matching `paths-ignore`. `deploy-api.yml` migrates before deploying, deploys the exact CI-passed SHA, minimal permissions, Workload Identity only. Privacy page matches the app's data (waitlist section is the known W4 gap). No analytics/crash SDKs on the site. Alt text, form ARIA and live region. No broken links, no `/pricing` leftovers. Metro blockList derived from `package.json`. TypeScript resolves to one version. Waitlist migration non-locking.

## Unconfirmed
Zone-level HSTS; live 429 path; `Access-Control-Allow-Origin: *` on the static site (likely a Pages default, low risk).
