# @forjd/web: getforjd.com

The public marketing site: Home, Features, Pricing and Privacy, plus a waitlist. Static Astro
output served by Cloudflare Pages. Decisions: `docs/decisions/ADR-051-marketing-website-and-waitlist.md`.
Plan and slice status: `docs/product/website-plan.md`.

## Commands

Run from the repo root.

| Command | What it does |
|---|---|
| `pnpm --filter @forjd/web dev` | Dev server on http://localhost:4321 |
| `pnpm --filter @forjd/web check` | Type-check `.astro` and `.ts` files |
| `pnpm --filter @forjd/web test` | Unit tests (Vitest) |
| `pnpm --filter @forjd/web build` | Build to `apps/web/dist` |

## Where things come from

- **Brand values** in `src/styles/global.css` are ported from `docs/design/website/design-v1.html`,
  which took them from the mobile design's tokens. Change them there first.
- **App screens** in `src/assets/screens/` are the mobile design's screenshots, cropped to their
  phone frames by `docs/design/website/crop-screenshots.js`. Astro converts them to WebP at build.
- **The link-preview image** `public/og.png` is made by `node scripts/make-og.mjs`.
- **Pro prices** live in `src/lib/pricing.ts`, which also computes the yearly saving.

## Rules that apply here

- No analytics or advertising scripts. Health data must never reach one (CLAUDE.md rule 15), and
  the site makes no third-party requests beyond Cloudflare Turnstile once the waitlist is live.
- Don't fill in undecided product content. The Free plan and the Terms of use stay visibly
  undecided until they are decided.
- Nothing is called "AI" unless it is. FORJD's insights are rules-based ("FORJD Insights").

