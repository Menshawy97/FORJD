# Website plan: getforjd.com

Status: **planned** (2026-09-21). Decisions in `docs/decisions/ADR-051-marketing-website-and-waitlist.md`.
Design source: `docs/design/website/design-v1.html` (the published preview, with `%%name%%`
placeholders where the cropped app screenshots were embedded; `crop-screenshots.js` produced them).

## What the user decided (2026-09-21)

| Question | Answer |
|---|---|
| Purpose | Promote the app. Not a web version of it. |
| Pages | Home, Features, Pricing, Privacy and legal |
| Main button | Waitlist sign-up |
| Domain and host | `getforjd.com`, bought at Cloudflare, served by Cloudflare Pages |
| Build | Astro, static output, one URL per page |
| Code location | `apps/web` in this monorepo |
| Waitlist storage | FORJD's own API and database |
| Confirm email | No, one step |
| Spam protection | Cloudflare Turnstile, plus a rate limit |

Still open, and shown as undecided on the site rather than filled in:

- **What is in Free versus Pro.** The pricing page shows Pro's price and features from the app's Go
  Pro screen and leaves Free blank.
- **The yearly discount label.** The app's Go Pro screen says "Save 40%", but $59.99 a year against
  $9.99 a month is 50%. The site says 50%; the app screen needs the same fix.
- **Terms of use** text, and a qualified review of the privacy page before launch.
- **Launch-day email**: which service sends it, and its cost. Not needed until launch.

## Ownership and sequencing

Another session owns the live run work (`feat/run-summary-api`, migration `0022`, uncommitted in the
shared checkout on 2026-09-21). This work runs in its own worktree (`.claude/worktrees/website`) and
never touches the shared checkout. **W3's migration is generated only after `0022` has merged to
`main`**, rebasing first, so drizzle-kit assigns the next free number instead of colliding.

## Slices

Each slice is a small PR, merged and confirmed green on `main` before the next (CLAUDE.md, Merging).

### W0: plan and ADR (docs only)

This document, ADR-051 and the design source under `docs/design/website/`. No CI run (docs-only).

### W1: `apps/web`, the four pages, form in "coming soon" state

1. Scaffold with the generator, not by hand: `pnpm create astro@latest apps/web -- --template minimal
   --no-install --no-git --typescript strict`, then add `apps/web` to `pnpm-workspace.yaml` and
   install from the root. Record the Astro version installed.
2. `@fontsource-variable/archivo` for the font (self-hosted, ADR-051); brand tokens in one
   `src/styles/tokens.css`, values copied from `design-v1.html`'s `:root`, which came from
   `design_handoff_forjd_mobile/02-design-tokens.md`.
3. Components: `Header`, `Footer`, `Phone` (screenshot in a frame), `WaitlistForm`, `Logo`.
   Pages: `/`, `/features`, `/pricing`, `/privacy`, plus a `404`. Content ported from
   `design-v1.html` section by section, audited against it value by value.
4. Screenshots: crop with `crop-screenshots.js` into `apps/web/src/assets/screens/`, rendered through
   `astro:assets` `<Image>` so they ship as sized WebP.
5. Search basics: per-page `<title>` and description, Open Graph image, `@astrojs/sitemap`,
   `robots.txt`, canonical URLs on `https://getforjd.com`.
6. `WaitlistForm` renders disabled with "Sign-ups open soon" until W4.
7. Tests first (the project's TDD rule): the email check and the form's state handling are a small
   TypeScript module with Vitest unit tests, written before the module. `astro check` and
   `astro build` must pass.
8. CI: a `web` job in `.github/workflows/ci.yml` running `pnpm --filter @forjd/web check`, `test` and
   `build`. Confirm the conformance script ignores `apps/web`, or scope it explicitly.
9. Verify in the browser preview at desktop and phone width (no sideways scroll, all images load,
   menu works), with screenshots.

### W2: Cloudflare Pages and the domain (user steps, then verification)

The user connects the repo in Cloudflare (steps to be given in chat, click by click, when W1 has
merged): project `forjd-web`, production branch `main`, root directory `apps/web`, build command
`pnpm build`, output `dist`, build watch paths `apps/web/*`; then the custom domains `getforjd.com`
and `www.getforjd.com`, with `www` redirecting to the bare domain. The assistant then verifies the
live pages, HTTPS, the redirect and a pull-request preview build.

### W3: `POST /api/v1/waitlist` (API vertical slice)

Test-first throughout, following the existing auth controller's pattern (`ZodValidationPipe`,
`@Throttle`).

1. **Contract** in `packages/contracts/src/waitlist.ts`: request `{ email, turnstileToken }` (email
   trimmed, lower-cased, max 254, valid format), response `{ status: 'accepted' }`. Spec and fixture
   first.
2. **Migration** (after `0022` is on `main`): `waitlist_signups` with `id uuid pk`, `email text not
   null unique` (stored lower-cased), `source text not null default 'website'`, `created_at timestamptz
   not null default now()`. Schema in `apps/api/src/database/schema/waitlist.schema.ts`, generated by
   drizzle-kit (rule 14). RLS enabled with no policies, like the other server-only tables.
3. **Turnstile adapter** in `apps/api/src/integrations/turnstile/`: an interface
   (`verify(token, remoteIp) → boolean`) and an implementation calling Cloudflare's `siteverify`
   endpoint, with contract tests against recorded responses (rule 8). Fails closed when the secret is
   missing in production; a test key is used in tests.
4. **Repository and service**: insert with `on conflict (email) do nothing`; the service verifies
   Turnstile first, then stores. Duplicate and new both return the same result.
5. **Controller**: `@Controller('waitlist')`, public (no auth guard), `@Post()` with
   `@HttpCode(202)`, `@Throttle({ default: { limit: 5, ttl: 600_000 } })`. A failed Turnstile check is
   `400` with a plain message; nothing is stored.
6. **CORS** (`cors.ts`, ADR-051 point 6): an allowlist from an `ALLOWED_WEB_ORIGINS` env var in
   production and staging; outside production the LAN Expo preview stays allowed. `cors.spec.ts`
   updated first, still pinning `credentials` off.
7. e2e test (`apps/api/test/waitlist.e2e-spec.ts`): accepted, duplicate, bad email, bad token,
   rate-limited.
8. `deploy-api.yml`: add `TURNSTILE_SECRET_KEY=forjd-${TARGET}-turnstile-secret-key:latest` to
   `--set-secrets` and `ALLOWED_WEB_ORIGINS` to `--set-env-vars`, only after the secrets exist
   (W4 step 1).

### W4: wire the form to the API

1. **User steps** (given in chat when W3 is ready): create a Turnstile widget in Cloudflare for
   `getforjd.com`, `www.getforjd.com` and the Pages preview domain, send back the **site key**, and
   store the **secret key** with `gcloud secrets create forjd-staging-turnstile-secret-key` (and the
   production one), granting the runtime service account access as in `production-setup.md` step 4.
2. Site: `PUBLIC_API_URL` and `PUBLIC_TURNSTILE_SITE_KEY` as Cloudflare Pages environment variables
   (preview points at staging, production at production). The form posts to the API and shows the
   same confirmation for new and existing addresses.
3. Privacy page gains a "Waitlist" section: what is stored, that it is used only for the launch
   email, and how to be removed.
4. Verify end to end against staging from a Pages preview: a sign-up lands in staging's
   `waitlist_signups`, a repeat does not duplicate, and a request from another origin is refused.

### W5: go live

Blocked on the production API (`docs/product/production-setup.md`, user steps). Then deploy the API
to production with the new secrets and point the production site at it. Check one real sign-up.

## Not in scope

Sending the launch email, analytics of any kind on the site (none is planned; if one is ever
proposed it needs its own decision), a blog, localisation, and a web version of the app.
