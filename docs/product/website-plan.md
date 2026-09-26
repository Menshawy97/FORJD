# Website plan: getforjd.com

Status: **W0-W3 and W6 done; W4 partly done. The site is live at https://getforjd.com and the form is wired (#239). Owed: the privacy page's "Waitlist" section (W4 step 3) and one real sign-up checked end to end (W4 step 4, W5).** (2026-09-26; `roadmap.md` is the source of truth.)
Decisions in `docs/decisions/ADR-051-marketing-website-and-waitlist.md`.
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
3. Components: `Header`, `Footer`, `Phone` (screenshot in a frame), `WaitlistForm`, `Logo`, `Wordmark` (the ADR-052 identity).
   Pages: `/`, `/features`, `/pricing`, `/privacy`, plus a `404`. Content ported from
   `design-v1.html` section by section, audited against it value by value.
4. Screenshots: crop with `crop-screenshots.js` into `apps/web/src/assets/screens/`, rendered through
   `astro:assets` `<Image>` so they ship as sized WebP.

   **Replaced 2026-09-24.** The design captures had drifted from the app (old logo, single-ring
   calorie circle). The ten screens are now captures of the real app, rendered
   with Expo web in headless Chromium against a demo account ("Omar H.", Alexandria) served from
   fixtures that validate against `@forjd/contracts`, then framed at 3x (1188 x 2481) and shipped
   as 1x/2x/3x WebP by `Phone.astro`. The top ember glow was checked pixel-for-pixel against the
   old captures (within one level of 255). Two screens are marketing-only states the app does not
   show today: Home's insight text, and Apple Health and Health Connect as connectable on the
   Connect screen (the app says "Coming soon" for both). `public/og.png` was rebuilt from the new
   Home and Rank screens with `scripts/make-og.mjs`.
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

**Both halves are done.** W3a (#231) was everything that touches no table: the contract
(step 1) and the Turnstile adapter (step 3), split out because migration `0022` (the live-run
session) had not yet landed and two sessions must not claim the same migration number. Once
`0022` reached `main` on 2026-09-22, W3b (steps 2, 4-7) followed: the `waitlist_signups`
migration, the repository and service, the public controller, and the CORS allowlist. Step 8
(the deploy secrets) waits for W4's user step, which creates them.

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

### W6: motion (sections slide up as you scroll)

Asked for on 2026-09-21: "i want to have skills to do animation in the website while the user is
scrolling i need each section to slide up into the view check for example sayapp.net suggest
animations for my approval". **Motions 1 to 4 below were approved and built (#229); 5 is a constraint. Originally: the proposals needed the user's sign-off before any of it was
built.**

**What sayapp.net actually does** (measured in the browser on 2026-09-21, not guessed). No animation
library: plain CSS plus an `IntersectionObserver` that adds a class.

```css
.reveal { opacity: 0; transform: translateY(28px);
          transition: opacity .7s cubic-bezier(.16,1,.3,1), transform .7s cubic-bezier(.16,1,.3,1); }
.reveal.visible { opacity: 1; transform: translateY(0); }
```

Children inside a section are staggered with `transition-delay` in 0.12s steps. Its hero uses the
same movement as a keyframe animation instead (`translateY(36px)`, 1s, delays 0 / .15s / .3s / .5s),
and two small cards drift on a 5s loop.

**Proposed for FORJD (1 to 4 approved and built; 5 is the restraint they run inside):**

1. **Section reveal** — the main ask. Each section fades in while sliding up 28px over 0.7s on that
   same easing, once, when about 15% of it has entered the viewport. Never replays on scroll back.
2. **Stagger inside a section** — the eyebrow, heading, body and list step in 0.12s apart, so a
   section arrives as a sentence rather than a slab. Phone screenshots ride with their section.
3. **Hero on load** — pill, headline, paragraph and form fade up from 36px at 0, .15s, .3s, .5s,
   matching the app's own launch feel. The phone cluster settles last.
4. **The example-week chart draws itself** — bars grow from the baseline and the HRV line traces
   left to right when the chart scrolls in. It is the one place where motion explains the content
   rather than decorating it, so it earns more than a fade.
5. **Restraint elsewhere** — no parallax, no floating cards, no motion on the pricing or privacy
   pages beyond the section reveal. Legal text should not move.

**Rules for the implementation, whichever of the above is approved.**

- **No animation library.** CSS plus one small `IntersectionObserver` module, unit-tested, in the
  same spirit as `src/lib/pricing.ts`. Astro ships no framework runtime today and this must not
  change that.
- **Everything is readable without JavaScript.** The `.reveal` starting state is applied by script,
  never in the served HTML, so a crawler, a link preview or a failed script shows finished content
  rather than a blank page. This is the opposite of what a naive `opacity: 0` in CSS would do.
- **`prefers-reduced-motion: reduce` disables all of it**, including the hero and the chart. Movement
  of this size is a real problem for people with vestibular disorders, and sayapp.net does not
  handle it — do not copy that part.
- Animate only `opacity` and `transform`, never layout properties, so scrolling stays smooth on a
  mid-range phone.
- Verify on the live preview at desktop and phone width, with reduced motion both off and on.

## Not in scope

Sending the launch email, analytics of any kind on the site (none is planned; if one is ever
proposed it needs its own decision), a blog, localisation, and a web version of the app.

## Progress log

- **W0** (2026-09-21, #221): plan, ADR-051, design source.
- **W1** (2026-09-21): `apps/web` built from `design-v1.html`: five pages, self-hosted Archivo,
  screenshots as WebP (about 15 KB each, down from about 110 KB), `og.png`, sitemap, robots, a
  `web` CI job, and the API job's build scoped to `@forjd/api...` so a website failure can't fail
  it. Findings on the way:
  - The yearly saving is 49.96%, not exactly 50%. `pricing.ts` rounds to the nearest percent and
    tests pin it; the app's "Save 40%" is still wrong.
  - The design's welcome screenshot lists "AI Insights", so it is not used on the site (the
    preview image uses Home and the leaderboard instead). The mobile welcome screen itself still
    says it, and should be renamed the same way the Home insight card was.
  - Vitest, not Jest, for `apps/web`: it is Astro's own recommendation and shares its Vite config.
  - `sharp` is a direct dependency: Astro 7 no longer installs it for image optimisation.
  - Two departures from the steps above: the email check (step 7) moved to W4, because the form is
    switched off in W1 and nothing would call it; the unit-tested module in W1 is the pricing copy
    instead. Brand values live in `src/styles/global.css` rather than a separate `tokens.css`,
    since they arrived together with the design's component styles.
- **W2** (2026-09-21): **live**. Cloudflare Pages project `forjd-web`, production branch `main`,
  root directory empty, output `apps/web/dist`, build command:

  ```
  pnpm install --frozen-lockfile --filter "@forjd/web..." && pnpm --filter @forjd/web build
  ```

  with `NODE_VERSION=24`, `PNPM_VERSION=11.22.0` and `SKIP_DEPENDENCY_INSTALL=1`. That last one
  matters: Cloudflare would otherwise install the whole workspace, including the mobile app's
  toolchain. The filtered install pulls 498 packages in about 40 seconds, then builds in about 30.
  Build watch paths are `apps/web/*, pnpm-lock.yaml, pnpm-workspace.yaml`, so app and API changes
  don't spend builds from the free 500 a month.

  Both custom domains are attached, and a zone Redirect Rule sends `https://www.*` to
  `https://${1}` with a 301, keeping path and query string.

  Verified from outside the network: all four pages, the 404, `robots.txt`, the sitemap, `og.png`
  and the icon return 200 over HTTPS on the apex, and `www.getforjd.com/features/?utm_source=x`
  301s to the apex with both path and query preserved.

  Two things worth knowing next time. The Pages dashboard's "Verifying" and "Complete DNS setup"
  labels on a custom domain lag well behind reality: the domain was already serving the site while
  both still showed as pending, so test with a real request rather than believing the badge. And
  the Cloudflare connector (the `cloudflare` plugin's MCP server) is installed but signing it in
  from one Claude instance does not sign it in for another, so a session that needs it must
  authenticate in that session.

  **Verified against the Cloudflare API** (2026-09-21, with a read-only token; every value matches the
  above):

  | Setting | Found |
  |---|---|
  | Production branch | `main` |
  | Build command | exactly as above |
  | Output directory, root directory | `apps/web/dist`, empty |
  | Environment variables, production **and** preview | `NODE_VERSION=24`, `PNPM_VERSION=11.22.0`, `SKIP_DEPENDENCY_INSTALL=1` |
  | Build watch paths | now `["apps/web/*","pnpm-lock.yaml","pnpm-workspace.yaml"]` (see the correction below) |
  | Custom domains | `getforjd.com` and `www.getforjd.com`, both `active` (validation and verification `active`) |
  | Zone | `getforjd.com`, `active` |

  **Correction, same day: the watch paths were broken, and this audit missed it.** They had been saved as
  one entry, `"apps/web/*, pnpm-lock.yaml, pnpm-workspace.yaml"`, not three, so nothing matched and
  Cloudflare skipped the production builds for both website merges (#229 and #230); the site stayed on the
  13:17 build until it was noticed. The API returned the bad value and it was read as correct. Fixed by
  re-entering them as three separate entries (`["apps/web/*","pnpm-lock.yaml","pnpm-workspace.yaml"]`).
  Lesson: after changing watch paths, do not trust the stored value, push a change under `apps/web/` and
  confirm a build actually runs. A skipped deployment shows every stage as `idle`.

  Not confirmable from here, and both are small. The redirect rule's own settings could not be read,
  because the token lacked the Single Redirect read permission; its behaviour is confirmed instead
  (`https://www.getforjd.com/features/?utm_source=x` returns 301 to the apex with path and query kept).
  And plain `http://` could not be tested from this network, where an ISP intercepts port 80.

  Preview deployments point at the same variables as production. That is right for now; W4 will give
  previews their own `PUBLIC_API_URL` pointing at staging.

- **W6** (2026-09-21, #229): scroll motion built, with motions 1 to 4 approved by the user (section
  reveal, stagger, hero on load, the chart drawing itself); motion 5 (restraint) is honoured by scope.
  Privacy and the 404 have none, pricing has only the plain reveal. Findings worth keeping:
  - The hidden starting state is switched on by an inline `<head>` script built from the tested
    `shouldAnimate`, not by a deferred module. Added late, the class let the page paint visible and
    then fade out. The served HTML still contains no hidden state.
  - It fails safe: the page script reports in, and if it never does the class comes off after 3s.
  - `IntersectionObserver` only reports changes, so after a jump to `/features/#eat` the 20 sections
    above the landing point stayed invisible. A coalesced sweep on scroll, load, pageshow and hashchange
    reveals what the reader is already past. A code review did not find this; the browser did.
  - The chart is observed as one unit. Observing each bar left bars clipped by a phone's scroll box
    permanently collapsed.
  - Use `threshold: 0` with a bottom `rootMargin`, not a ratio, which an element taller than about 6.7
    viewports can never reach.
  - Also shipped: the hero phone cluster now sits beside the headline and was resized three times to the
    user's direction (larger, then smaller, then 20% smaller, with a little more spread).
- **Nutrition on the home page** (2026-09-21, #230): a Nutrition row between Readiness and Body
  composition, reusing the existing screenshot and the Features page's copy. It claims nothing about
  Free versus Pro. Body and Leaderboards swapped their `flip` class so the phones keep alternating.
- **W3a** (2026-09-21, #231): the parts of the waitlist that touch no table.
  - `packages/contracts/src/waitlist.ts`: request `{ email, turnstileToken }`, email trimmed and
    lower-cased then validated then capped at 254; token 1 to 2048 characters. The response's only value is
    `accepted`, so a new address and a repeat are indistinguishable.
  - `apps/api/src/integrations/turnstile/`: a `TurnstileClient` behind a token, mirroring the WHOOP
    client. `verify()` fails closed and never throws. Two attempts of 5s, not three of 10s: the endpoint is
    public, so each anonymous caller can hold a request open, and Turnstile tokens are single-use, so a
    retry after a lost reply is likely refused anyway. `redirect: "error"`, so the secret is never
    re-sent elsewhere. Logs error codes and the error name, never the secret or the token.
  - `TURNSTILE_SECRET_KEY` is deliberately not in the required-env schema, so staging and dev boot before
    it exists. The module is not imported by `AppModule` until W3b gives it a consumer.
  - Gotcha for next time: a stale `packages/domain/dist` makes unrelated contract specs fail with
    "no exported member"; `pnpm --filter @forjd/domain build` fixes it. And `pnpm --filter
    @forjd/contracts fixtures` rewrites every fixture's line endings on Windows with no content change;
    revert those and keep only the new file.
  - For W3b: the controller must set a request body limit, and take the caller address only from the
    trusted proxy header (`CF-Connecting-IP`), never a raw `X-Forwarded-For`.
- **W3b** (2026-09-22): the rest of the waitlist. `waitlist_signups` (migration 0023: id, email
  unique, source default 'website', created_at) with no RLS -- `docs/architecture/security.md`
  (ADR-038) corrected the plan's original "RLS enabled with no policies": the API reaches Postgres
  directly with `DATABASE_URL`'s role, never through the PostgREST path RLS gates, so adding it
  would only be bypassed, not a second layer. `WaitlistRepository.signUp` inserts with
  `on conflict (email) do nothing`; `WaitlistService` verifies Turnstile first, then stores, and
  returns the identical `{ status: 'accepted' }` for a new address and a repeat. The controller is
  public (no guard), `202`, `@Throttle({ limit: 5, ttl: 600_000 })`, keyed by `req.ip` (trustworthy
  because `trust-proxy.ts` already tells Express to trust exactly Cloud Run's one hop). `cors.ts`
  now reads `ALLOWED_WEB_ORIGINS` (comma-separated): set, it allowlists; unset (every environment
  today), it reflects any origin exactly as before, so nothing changes until W4 sets the variable.
  e2e test spends the endpoint's 5-request budget across the plan's own five cases -- accepted,
  duplicate, bad email, bad token, rate-limited -- in that order, so the fifth call is the one that
  hits 429. Step 8 (`deploy-api.yml`'s secrets) is left for W4, which creates them first.
