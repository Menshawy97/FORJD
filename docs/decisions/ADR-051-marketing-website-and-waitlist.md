# ADR-051: A static marketing site on Cloudflare, with the waitlist behind the NestJS API

**Status:** Accepted
**Date:** 2026-09-21

## Context

FORJD needs a public website before launch: a home page, a features page, pricing, and privacy and
terms (the app stores need a privacy policy URL anyway). Its one job is to collect waitlist sign-ups.
The user owns the domain `getforjd.com`, bought through Cloudflare. A first design exists (published
as a private preview, built from the mobile design's tokens and real screens).

Five things had to be decided: where the site is hosted, what it is built with, where its code lives,
where waitlist emails are stored, and how the form resists spam. The user decided each of them on
2026-09-21; the project's free-tier-only constraint (ADR-015) applies throughout.

## Decision

1. **Hosting: Cloudflare Pages, on `getforjd.com`.** The domain's DNS is already at Cloudflare, so
   attaching it is a few clicks. The free plan (checked 2026-09-21 against
   developers.cloudflare.com/pages/platform/limits) allows 500 builds a month, 100 projects, 20,000
   files per site and 25 MiB per file, far more than a four-page site uses. Deploys come from
   Cloudflare's GitHub integration, with build watch paths limited to `apps/web/**` so app and API
   changes don't spend builds. Every pull request gets a preview URL.
2. **Build: Astro, as static output.** Each page gets its own URL (`/features`, `/pricing`,
   `/privacy`), which the single-file preview could not give search engines or shared links. No
   server rendering and no Cloudflare Functions: the site is plain files.
3. **Code: `apps/web` in this monorepo**, a pnpm workspace member, so it can share brand values and
   goes through the same CI. The mobile design (`FORJD mobile app design/`) remains the source of
   truth for colour, type and the logo.
4. **Waitlist storage: the NestJS API**, as `POST /api/v1/waitlist`, into a `waitlist_signups` table
   added by a drizzle-kit migration. Not a Cloudflare Worker, D1 or a Supabase Edge Function: NestJS is
   the only application layer (CLAUDE.md rule 13), and a third-party form service was declined so the
   list stays in FORJD's own database.
   - One step, no confirmation email. Signing up is enough; nobody is emailed before launch, so a
     mistyped address costs little.
   - The endpoint always answers `202 Accepted` with the same body, whether the address is new or
     already on the list, so it cannot be used to test who has signed up.
   - It stores the lower-cased email, the time and a `source` (`website`). No IP address and no
     user agent.
   - Waitlist emails are personal data but not health data; they never go to an analytics or
     advertising tool either, and the privacy page says how to be removed.
5. **Spam: Cloudflare Turnstile plus a rate limit.** The site renders Turnstile's widget (free, usually
   invisible); the API verifies the token server-side before storing anything, through an adapter in
   `apps/api/src/integrations/turnstile/` (rule 4). The secret key lives in Secret Manager as
   `forjd-<target>-turnstile-secret-key`, never in the site's code (rule 5); the site key is public by
   design. The endpoint also carries a tight per-IP `@Throttle`.
6. **CORS narrows to an allowlist.** `apps/api/src/cors.ts` reflects any origin today, and its own
   comment says to narrow it once a browsable web surface exists. Production allows
   `https://getforjd.com` and `https://www.getforjd.com`; staging also allows the Pages preview
   domain. Requests without an `Origin` header (the native app) are unaffected. The dev-time Expo web
   preview, which runs from a LAN IP, stays allowed outside production.

## Consequences

- The waitlist only works once the production API is live, which depends on the user's steps in
  `docs/product/production-setup.md`. Until then the site can go live with the form pointed at
  staging for testing, or showing "coming soon".
- Fonts are self-hosted from the site rather than loaded from Google Fonts, so a visitor's IP is not
  sent to a third party just to render text. Turnstile's script is the one third-party request.
- Sending the launch-day email is a separate, later decision (an email-sending service, and its
  cost), not part of this ADR.
- Undecided product content stays visibly undecided on the site: the Free plan's contents, and the
  Terms of use.
