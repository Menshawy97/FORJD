# FORJD brand refresh — new logo, web header reveal, app loader, app intro

## Context
The user has a new FORJD identity in the Design canvas "FORJD Logo"
(https://claude.ai/artifact/23Cj4sYhRb3mShCr9Upuip). It replaces the old four-bar mark everywhere
(website + app). Three animations from that canvas ship:
- **#4 Reveal** → website header, top-left, plays once per visit/refresh.
- **#3 Pulse loader** → the app's bigger loading states (e.g. InBody waiting for its result).
- **#9 Readiness ring** → a new in-app intro screen on every cold start, before Welcome/Home.

### Decisions made with the user
| Question | Answer |
|---|---|
| Intro (#9) when | Every cold start (not on resume). Signed-in → Home, signed-out → Welcome. |
| Intro length | Trimmed to ~3.3 s (design timings up to the wordmark landing, short hold, fade). |
| Loader (#3) where | Bigger waits only. In-button / per-card spinners stay. |
| App icon + favicon | Both — the **DARK** tile (`#1B1B1D`, 1px `#2A2A2D` border, ember `#E9712F` mark), not Ember. |
| Web header tagline | No — symbol + wordmark only. |
| Web replay | Only on arrival from outside the site or a refresh; not on internal link clicks. |

### Brand source values (from the canvas, verbatim)
- Symbol (viewBox 0 0 100 100), fill `#E9712F`: `M8 8H60V24H24V42H60V58H24V92H8ZM64.5 8H92V66A26 26 0 0 1 66 92H40V76H66A10 10 0 0 0 76 66V24H64.5Z`
- Pulse pieces: stem `rect 8,24 16×68`; top `rect 8,8 52×16`; mid `rect 24,42 36×16`; J = the second subpath.
- Wordmark (viewBox 0 0 544 100, `#EDEBE6` on dark): the 7 paths in `project/Main.dc.html` (F, O evenodd, R stem, R bowl evenodd, R leg, J, D evenodd).
- Palette: Ink `#101011`, Graphite `#1B1B1D`, Bone `#EDEBE6`, Ember `#E9712F`, line `#2A2A2D`, meta `#8C8C91`.
- **#4 Reveal** (4.4 s cycle; mark 120, gap 36, wordmark 330×61, easing `cubic-bezier(.7,0,.2,1)`): mark 0% `opacity0 translateX(183px) scale(.6)` → 14% `opacity1 scale(1)` → hold to 30% → 44% `translateX(0)`; word clip-path `inset(0 100% 0 0)` 0–40% → `inset(0)` 58%; edge: 3px ember bar (top/bottom −8px) `left 0→100%` 40–58%, fades 58–64%.
- **#3 Pulse**: each piece opacity `.16`; keyframes `0% .16 · 18% 1 · 55–100% .16`; 1.6 s `cubic-bezier(.4,0,.2,1)` infinite; delays 0 / .18 / .36 / .54 s (stem, top, mid, J).
- **#9 Ring** (4.8 s cycle): 300px ring, r 140, stroke 6, track `#1B1B1D`, ember arc, round cap, from 12 o'clock. Arc dashoffset 1→0 over 4–36% `cubic-bezier(.6,0,.2,1)`; ring `opacity1 scale1 → opacity0 scale1.12` 36–46% `cubic-bezier(.4,0,.2,1)`; mark 140px at ring centre `opacity0 scale.4 → 1` 36–46% `cubic-bezier(.3,1.4,.5,1)`; word block (wordmark 300×55 + tagline 13px/500/.34em `#8C8C91`, inner gap 20, column gap 44) `opacity0 translateY(14) → 0` 50–62% `cubic-bezier(.2,.7,.2,1)`.
  Trimmed: same absolute times to 2.98 s, hold to 3.0 s, fade 3.0→3.3 s, `onDone` at 3.3 s.

## Execution setup
Dedicated git worktree (other sessions share the main checkout). Two PRs, each off `main`, tests first.
First commit of PR 1: this plan as `docs/product/brand-refresh-plan.md` + ADR-052.

### PR 1 — Website (`apps/web`, Astro 7, plain CSS)
1. `src/components/Logo.astro` → new symbol (keeps `size` prop, `aria-hidden`).
2. New `src/components/Wordmark.astro` — the wordmark SVG, `fill="currentColor"`, `role="img" aria-label="FORJD"`.
3. `Header.astro`: brand link = mark + wordmark wrapper (with the edge bar element). Scale #4 to the 68px header: mark 28px, wordmark 15px tall (~82px wide), gap 8px; start offset = (gap + wordmark width)/2, the same ratio 183 = (36+330)/2 uses.
4. `global.css`: #4 keyframes, iteration 1, `fill-mode: both`, ~2.6 s (the 0–64% portion of the 4.4 s cycle; loop fade dropped), active only under `html.brand-intro`. `global.css:72` `.brand` text styles replaced.
5. `src/lib/brand-intro.ts` pure `shouldPlayIntro({navType, referrer, origin, reducedMotion})`; inlined into `Base.astro` `<head>` as a pre-paint script that adds `brand-intro` for `reload` or a non-same-origin referrer, never under reduced motion.
6. `Footer.astro`: static symbol + wordmark.
7. `public/favicon.svg` → DARK tile (32×32, rx 7, `#1B1B1D`, 1px `#2A2A2D`, ember symbol ~18px). `scripts/make-icons.mjs` (like `make-og.mjs`, uses `sharp`) → `public/apple-touch-icon.png` 180×180; linked in `Base.astro`.
8. Tests (vitest, first): `shouldPlayIntro` cases (reload, external, internal, no referrer, reduced motion); built header HTML contains wordmark SVG + `aria-label="FORJD home"`.
9. Verify: `pnpm --filter @forjd/web check && test && build`; browser-pane preview: screenshots mid/end animation, internal click → no replay, reload → replay, 375px width.

### PR 2 — Mobile (`apps/mobile`, Expo 57, react-native-svg 15, Reanimated 4)
New `src/components/brand/`:
- `brand-paths.ts` — symbol, pulse pieces, wordmark path strings (single source).
- `logo-mark.tsx` (`size`, `color`), `wordmark.tsx` (`width`, `color`, `accessibilityLabel="FORJD"`).
- `logo-loader.tsx` (#3) — four stacked `Animated.View`s, one piece-`Svg` each, opacity via built-in `Animated` loops (native driver) with per-piece delays and `Easing.bezier(.4,0,.2,1)`. Default 44px; `accessibilityRole="progressbar"`, label "Loading". Reduce-motion → static.
- `intro-splash.tsx` (#9) — full-screen `#101011`; `onDone` at 3.3 s (reduce-motion: static lockup, 800 ms). Transforms always present (no conditional transform key). **Built on the built-in `Animated` API, not Reanimated** (changed during build): the root layout loads in every route-tree test, where expo-router's testing library replaces Reanimated with an empty module. Opacity/transforms use the native driver; only the arc's `strokeDashoffset` is JS-driven, for 1.5 s.
- `intro-gate.ts` — module-scope "already played in this process" flag; `jest/testing-library-setup.js` marks it played so route-tree tests start on their screen.

Wiring:
1. `src/app/_layout.tsx`: `introDone` state; once fonts+auth resolve, render today's Stack/gates plus `{!introDone && <IntroSplash onDone=… />}` as an absolute-fill overlay. Routing is untouched, so the intro precedes Welcome (signed out) or Home (signed in); in-memory state → every cold start, not on resume.
2. `app.config.ts` splash: background `#101011` with a transparent image, so the native splash hands off seamlessly to the intro's first frame.
3. Logos: `welcome.tsx:45-78` bars + text → `LogoMark` + `Wordmark`; `features/home/home-header.tsx:27-29` likewise. Remove the `wordmark` glyph (`components/icon.tsx:156`) and `wordmark*` sizes (`tailwind.config.ts:207-228`) if unused afterwards.
4. Loaders (#3): `inbody.tsx:127` (size 56), `(tabs)/train.tsx:437`, `workout/[id].tsx:161`, `program/[id].tsx:140` (loading branch only), `programs.tsx` (`programs === null` renders nothing today → loader). Keep `Spinner` (`connect.tsx:215`) and the button indicator (`inbody-confirm.tsx:419`).
5. Icons via committed `apps/mobile/scripts/make-icons.mjs` (sharp): `icon.png` 1024 full-bleed DARK tile; Android adaptive: background `#1B1B1D`, foreground ember symbol in the 66% safe zone, monochrome white symbol; `favicon.png`; transparent `splash-icon.png`. `ios.icon` currently points at the untouched Expo template `assets/expo.icon` → repoint to `./assets/images/icon.png` and delete the template bundle. Adaptive `backgroundColor` → `#1B1B1D`.
6. Delete template leftovers (`expo-logo.png`, `react-logo*.png`, `tutorial-web.png`, `logo-glow.png`) after grep confirms no references.
7. Tests first (jest-expo): `logo-loader` (a11y label, 4 pieces); `intro-splash` (fake timers: no `onDone` at 3.2 s, called at 3.3 s; reduce-motion); `_layout` (overlay at start, gone after timers, routing intact); `inbody` (loader while extracting). Existing `getByText('FORJD')` in `home-fidelity`, `home-nutrition-card`, `login`, `swipe-back-login`, `welcome-fidelity` → `getByLabelText('FORJD')`; root-layout tests advance past the intro.
8. Verify: `pnpm --filter mobile typecheck && lint && test`; `expo config --type public` for icon paths; Expo web in the browser pane — screenshots of intro, welcome, home header, InBody loader. Physical-device check of icon/splash flagged to the user, not a gate.

## Docs
- `docs/decisions/ADR-052-brand-identity.md`: symbol/wordmark/palette, animation placement, DARK icon, supersedes ADR-051's logo clause and the `#A84D1D` third-bar note in `02-design-tokens.md`.
- `docs/product/brand-refresh-plan.md`; `docs/product/website-plan.md` component list (+`Wordmark`).

## Finish (per PR)
code-reviewer + typescript-reviewer agents, fix HIGH+, push, PR, CI green, merge, then `gh run list --branch main` / `gh run watch` until `main` is green.

## Found during build
- `metro.config.js` blocked every path containing `.claude/worktrees/`, which includes the app's own files when Metro runs *inside* a worktree ("Unable to resolve expo-router/entry"). Anchored the pattern to the current workspace root.
- Expo **web** still cannot bundle in this repo (expo-sqlite's web worker: "Worker chunk not found"), unrelated to this work, so the intro was previewed as an HTML mirror of the component and verified on native via `expo export`.
