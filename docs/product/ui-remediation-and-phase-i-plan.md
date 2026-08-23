# FORJD — fidelity/navigation remediation, then slice 2 Phase I (`privacy` + `notifs`)

## Orientation for a fresh session

Repo: `C:\Users\Mostafa Ashraf\Desktop\FORJD` (pnpm monorepo). Mobile app is `apps/mobile`
(Expo SDK 54, Expo Router v6, NativeWind 4). API is `apps/api` (NestJS + Drizzle). Shared Zod
wire contracts in `packages/contracts`, pure domain types in `packages/domain`.

**Where truth lives.** `docs/product/roadmap.md` is the execution state. `docs/product/slice-2-plan.md`
has locked decisions and build order. `docs/design/slice2-screen-specs.md` transcribes the
runnable prototype for the slice-2 screens. **The prototype itself —
`FORJD mobile app design/FORJD Mobile.dc.html` — outranks every summary doc**, including
`design_handoff_forjd_mobile/*.md`, which contradicts it in ten known places. It is ~300KB;
grep it, don't read it whole. Screen render functions are `s_login()`, `s_signup()`,
`s_goals()`; shared primitives are `btn()`, `field()`, `row()`, `toggle()`, `icon()`,
`socialRow()`.

**Commands.**
- `TZ=UTC pnpm --filter @forjd/mobile test --ci --watchAll=false` — **`TZ=UTC` is not optional**:
  CI runs UTC and a Phase G test passed locally then failed on CI for exactly this reason.
- `pnpm --filter @forjd/mobile typecheck` / `lint`
- Expo: `npx expo start --offline` from `apps/mobile` (plain `expo start` fails with
  `TypeError: fetch failed` here). `--offline` suppresses the QR; connect Expo Go manually to
  `exp://<machine-LAN-IP>:8081`.
- **Web preview does not work for authenticated screens** — `expo start --web` throws
  `ExpoSecureStore.default.getValueWithKeyAsync is not a function` before render on anything
  calling `getMe()`. Pre-existing, unrelated to this work. Unauthenticated screens preview fine.

**Standing rules that shape this work.** Strict TDD, RED confirmed before GREEN, every step.
Validate independently and run `react-reviewer` before calling anything done. At each
checkpoint: update docs → open PR → CI green → merge → **then confirm CI green on `main`
itself** (a green PR is not proof; docs-only changes skip CI by `paths-ignore`, and that
absence is correct). Prefer several small checkpoints over one large one.

**Status.** Slice 2 backend (phases A–F) and mobile phases G (`editProfile` + `units`) and H
(`location` + `goals`) are merged and green on `main`. This plan is two PRs: **Part 1** fixes
defects in already-shipped screens; **Part 2** builds Phase I. Part 1 goes first because it
includes a live navigation bug, and because Part 2 touches the same screens.

---

# Part 1 — Fix what's already shipped (PR 1)

## 1.1 The swipe-back bug — CRITICAL

**Reported symptom:** swiping back from any screen lands on `welcome` and appears to sign the
user out. The in-app back chevrons work fine.

**Confirmed root cause** (traced, not guessed): **the session is never cleared.** `clearSession`
has exactly two callers — the logout button (`(tabs)/profile.tsx:106`) and a failed token
refresh (`auth/apiClient.ts:104`) — neither reachable from a gesture. The user stays
authenticated; they just land on a screen that offers only "Create Account" / "Log In", which
is indistinguishable from being signed out.

The real defect is **stack shape**. `welcome.tsx:84/92` *push* to `/signup` / `/login`, then
`login.tsx:64` and `goals.tsx:100` *replace* the top entry with the app. `replace` swaps the top
and never clears history, so `welcome` is parked permanently at stack index 0. Every subsequent
navigation in the app is also `router.replace` (17 call sites, no `push` outside welcome), so
depth stays at exactly 2 for the whole session. `react-native-screens` enables the interactive
pop gesture whenever depth > 1 — and the only thing to pop to is `welcome`.

`app.config.ts`'s `predictiveBackGestureEnabled: false` only disables Android's *animation*; the
gesture still pops.

**Fix — reset the stack at both auth boundaries.** Replace the bare `router.replace` with a
dismiss-then-replace so the authenticated app is mounted at depth 1 and the gesture has nothing
to pop to:

```ts
if (router.canDismiss()) router.dismissAll();
router.replace('/');
```

Apply at `login.tsx:64` (login success) and `signup.tsx:106` (signup success → `/goals?returnTo=newAccount`).
Both are the moment the app crosses from public to authenticated, and both currently leave
`welcome` underneath. `goals.tsx:100`'s first-run `replace('/')` then runs at depth 1 already.

**Do not** reach for `gestureEnabled: false` as the primary fix. It suppresses the symptom on
iOS while leaving the phantom entry in place, and Android's system back button pops regardless
of that option — it is a JS-stack/iOS-swipe flag only.

**Add an inverse auth gate as a safety net** in `_layout.tsx`. Today `AuthGate` only renders when
`!authenticated`, and it allowlists `welcome`, so nothing bounces a *signed-in* user off the
public screens. Add the opposite direction: authenticated + on `welcome` or `login` → redirect
to `/`.

> **Important interaction — do not include `signup` in that inverse gate.** `saveSession` fires
> at `signup.tsx:104`, *before* the navigation on 106, so the user is already authenticated when
> the first-run `goals` screen's back chevron sends them to `/signup` — which is the prototype's
> documented back-chevron trap (`slice2-screen-specs.md` §4.1/§4.6). Gating `signup` would break
> a behaviour Phase H deliberately implemented and tested.

**Tests.** New: after login, `router.canGoBack()` is false / the stack cannot pop to `welcome`;
an authenticated user landing on `/welcome` is redirected to `/`; an authenticated user on
`/signup` is **not** redirected (pins the trap above). Existing tests that must stay green:
`back-navigation.test.tsx` (pins push→back for the *unauthenticated* welcome→login→back flow —
unaffected, it happens before the boundary), `login-back-destination.test.tsx`,
`root-layout.test.tsx`.

## 1.2 Save buttons "don't match the design" — root cause found

I assumed the CSS `box-shadow` token simply didn't render on React Native. **That assumption was
wrong** and worth recording: NativeWind 4.2.6 disables Tailwind's `boxShadow` core plugin and
substitutes its own plugin that emits real RN props (`shadowColor` / `shadowOffset` /
`shadowRadius` / `shadowOpacity`, plus `elevation` on Android). The token translates correctly.

**The actual bug:** four screens pass an *opaque* `shadowColor` inline, on top of the class that
already set the correct translucent one. NativeWind gives `style` precedence over `className`, so
the design's `rgba(233,113,47,.22)` is overridden by `colors.accent` = `#E9712F` at **alpha 1.0** —
a roughly 4.5× too-heavy orange halo.

| File | Line |
|---|---|
| `apps/mobile/src/app/edit-profile.tsx` | 238 |
| `apps/mobile/src/app/units.tsx` | 142 |
| `apps/mobile/src/app/goals.tsx` | 197 |
| `apps/mobile/src/app/location.tsx` | 131 |

`welcome.tsx:86`, `login.tsx:170`, `signup.tsx:177` have no inline override and are correct —
which is exactly why the **Save** buttons look wrong while the auth CTAs look right. That
inconsistency is what the user is seeing.

**Fix:** delete `shadowColor: colors.accent` from those four lines; the class already supplies it.
While there, move the inline `height: 52` to the `h-[52px]` class the other three use.

**Also add an explicit `elevation` theme key** in `tailwind.config.ts` beside `boxShadow`.
NativeWind's `getElevation()` falls back to scraping the blur radius when no `elevation` theme
entry exists, giving Android **elevation 22** — a very heavy hard black shadow, not the design's
soft orange glow. Pick a deliberate value rather than letting it be inferred.

**Note for testing:** `cta-affordances.test.tsx:15-18` documents that the *rendered* shadow can't
be asserted under Jest (NativeWind's transform doesn't run); line 79 only asserts the class string.
So no unit test would have caught this, and none can. Verify on device.

## 1.3 Ghost buttons have a pressed transform the design doesn't have

`press-feedback.ts:28-31`'s `pressGhost` applies `scale(.985)`. The prototype's `btn()` puts the
active transform **only** on the primary branch; `slice2-screen-specs.md` §1 calls this out
explicitly — *"(ghost has NO active/pressed rule)"*. Remove the transform, keep the background
change, and fix the misleading header comment at lines 8-9 ("any button, active → scale(.985)").
Affects `welcome.tsx:93` and `location.tsx:139`.

## 1.4 The missing social auth row

`signup.tsx:26-27` and `login.tsx:19-20` both defer it as "out of Phase 1 scope". The prototype
draws it on **both** screens via a shared `socialRow()` helper — `s_login()` line 1424 and
`s_signup()` line 1452 (verified).

Build `apps/mobile/src/components/social-auth-row.tsx` from the prototype's values
(`FORJD Mobile.dc.html` lines 1141-1165):

- Container: `marginTop 22`, column, `gap 16`.
- Divider: row, `alignItems center`, `gap 10` — a 1px `rgba(255,255,255,.07)` rule on each side
  (`flex: 1`) with the literal text **`OR CONTINUE WITH`** between them, `500 11px/1`,
  `letterSpacing .04em`, `colors.dimmer`.
- Buttons: row, `gap 12`, **Google first, then Apple**. Each `flex: 1`, height 52, radius 12,
  centered, `gap 9`, `600 14px/1`, border `colors.border`, background `colors.fieldBg`, text
  `colors.text`. **No pressed/active rule** (unlike primary `btn()`).
- Labels are **`Google`** and **`Apple`** — *not* "Continue with Google/Apple". The handoff doc
  (`01-screen-inventory.md:77`) gets both the labels and the order wrong; the prototype wins.
- Behaviour: the prototype's buttons call `flash('Continuing with Google…')` /
  `flash('Continuing with Apple…')` (single `…` character). **There is no OAuth backend.**
  Per the same reasoning used elsewhere in this codebase, do **not** ship a toast that implies
  something happened — render the buttons per the design and leave them inert, matching how
  `profile.tsx` handles destinations that don't exist yet. Wiring real Google/Apple sign-in is a
  separate slice needing provider setup, an ADR, and Apple's "Sign in with Apple" review
  requirement.

**Icons need a new path.** `components/icon.tsx` is a monochrome **stroke-only** registry
(`DEFAULT_STROKE_WIDTH = 1.6`, a single `stroke` color, no `fill` shape kind). Google's mark is
four *filled* paths in four brand colors and Apple's is a filled single-color path, so neither can
go through `Icon` as it stands. Either add a `fill` shape kind to `Icon`, or give the row its own
small local SVGs. Exact path data is at `FORJD Mobile.dc.html` lines 1157-1163 — transcribe
verbatim, do not redraw.

Mount after the primary CTA and before the trailing text on each screen: `signup.tsx` after line
179 (before the legal footnote), `login.tsx` after line 172 (before "No account? Create one").

## 1.5 `profile.tsx` still shows sample data that contradicts a shipped decision

`(tabs)/profile.tsx:28` renders `handle: '@jmitch · Alexandria'`. `slice2-screen-specs.md`'s own
decisions box records: *"§12 — the `@jmitch` handle | **Dropped.** No `handle` column, no username
concept. That line shows city alone."* Fix that line to show the city alone.

The rest of that screen's sample data (`James Mitchell`, row subtitles) is **Phase J's job** by the
existing plan — leave it, except note that the Goals and Units subtitles (`lines 46`, `54`) are now
backed by real saved values and are the natural first things Phase J wires.

## 1.6 Smaller `goals.tsx` deltas

- **Line 229:** unselected pick-row background is `colors.elevated` (`#191A1C`); the prototype
  (line 1731) uses `CARD` = `#17181A` = `colors.surface`. One shade too light.
- **Lines 229/231/245:** three raw color literals inline (`rgba(233,113,47,.1)`,
  `rgba(233,113,47,.45)`, `#37383c`). `tailwind.config.ts`'s header (citing ADR-010) forbids
  inlining values — add tokens.
- **Line 140:** `letterSpacing: -0.02 * 26` is computed by hand, duplicating what
  `text-screen-header` already declares. NativeWind resolves `em` at runtime (verified), so the
  inline override is redundant and will drift.
- **Lines 165-172:** the Activities grid uses `flex-wrap` + `width: '48%'` where the prototype
  (line 1746) uses `grid-template-columns: 1fr 1fr; gap: 8` — about 3pt narrower per column on a
  393pt screen. Cosmetic; fix if cheap.

---

# Part 2 — Slice 2 Phase I: `privacy` + `notifs` (PR 2)

Both are toggle lists, backed differently:

- **`privacy`** writes to a real endpoint. `PATCH /api/v1/users/me/privacy` already exists
  (`apps/api/src/users/users.controller.ts`) with all five flags on `updatePrivacyRequestSchema`.
  The design spec's "blocked on backend" note for this screen is **stale**.
- **`notifs`** has no backend and won't until push (Phase 6/8). Device-local only, per the spec's
  own resolution box.

`privacy` also finishes Phase H's work: `location.tsx` was built with a `?back=privacy` param
nothing sets, and an `as Href` cast for a route that didn't exist.

## Decisions

**Notifs persists to AsyncStorage, behind a store seam.** Five booleans plus a quiet-hours window
is flat key-value data. `expo-sqlite` (a dependency, imported nowhere) is the wrong shape — a table
holding six scalars; it earns its place later for offline workout sessions. MMKV is the production
standard for speed but needs a custom dev client, breaking the Expo Go workflow ADR-007 depends on.
`expo-secure-store` is for secrets and is the auth layer's seam. AsyncStorage is the RN default for
exactly this and works in Expo Go. These preferences move server-side once push exists, so they go
behind `store/notification-preferences.ts` rather than being called inline — that migration becomes
an adapter swap, not a screen rewrite. (`apiClient.test.ts`'s "no AsyncStorage" guard reads only
`apiClient.ts`'s own source — verified — so it needs no change.)

**"Preview my public profile" and "Download my data" render inert.** The athlete screen is Phase J
and `POST /me/export` doesn't exist; the prototype's "Export requested — we will email you" toast is
factually untrue. Same precedent as `profile.tsx` — "a Pressable to nowhere is worse than no
Pressable."

**`privacy` mirrors the server's leaderboard/location dependency client-side.** The server rejects
`locationForLeaderboard: true` without `leaderboardOptIn` (400) and cascades the child off when the
parent goes off. The design defines no disabled row state, so mirror the rule in both directions
rather than inventing one: parent **off** turns the child off; child **on** turns the parent on.
Single-tap either way, no invented visual state, 400 structurally unreachable. Same approach
`units.tsx` took for ADR-016's preset coupling.

## Build order (strict TDD)

**Step 1 — `components/toggle.tsx`.** No toggle/switch exists anywhere; every screen so far rolls
its own control. Geometry from `slice2-screen-specs.md` §1: track 46×27, radius 14, padding 3,
background `colors.accent` on / `colors.toggleTrackOff` off; knob 21×21, radius 11, white,
`translateX(19px)` when on — **19, not 21**; spec §9 discrepancy #3 records the handoff doc getting
this wrong. Presentational only; the row owns the tap.

**Step 2 — `components/toggle-row.tsx`.** Both screens render this shape five times. Padding
`15px 2px`, `borderBottomWidth 1` in `colors.borderFaint`, title `600 14.5/1.25` `colors.text`,
subtitle `marginTop 3` `400 12/1.3` `colors.dimmer`, trailing `Toggle`. **The whole row is the tap
target**, not the 46×27 track — the project's one approved deviation from the prototype, recorded in
three places (`slice2-screen-specs.md` §11 Q7 resolution box, `slice-2-plan.md`, `roadmap.md`) as an
accessibility minimum-tap-target fix that changes behaviour, not appearance.
`accessibilityRole="switch"`, `accessibilityState={{ checked }}`.

**Step 3 — `store/notification-preferences.ts`.** `load()` / `save()` over AsyncStorage under one
key. Returns spec defaults when nothing is stored *and* on a corrupt value, rather than throwing into
a screen with no error UI. Install with `npx expo install @react-native-async-storage/async-storage`.

**Step 4 — `app/notifs.tsx`.** Shared `Header title="Notifications"` → `/profile`. Tab bar shown,
Profile lit — reuse `components/tab-bar.tsx` from Phase H, don't write a second copy. Copy verbatim
from §5.2 including "Two rules: nothing at night, nothing you cannot act on." Five rows in order:
Workout reminders, Recovery alerts, PR celebrations, Leaderboard moves, Weekly summary. Defaults
`{workout: true, recovery: true, pr: true, rank: false, weekly: true}` — **Leaderboard moves is the
one that starts off.** Quiet-hours block: `Icon name="clock"` at 20px `colors.metadata`, the literal
`22:00 — 07:00` (em dash, spaces either side), and a `Change` control in `colors.accent` that fires
`toast.show('Edit quiet hours')` and nothing else — no editor exists in the design. **No Save
button**; toggles apply and persist immediately.

**Step 5 — `updatePrivacy` in `auth/apiClient.ts`.** Exact analog of the existing `updateProfile`:

```ts
export async function updatePrivacy(
  patch: UpdatePrivacyRequest,
): Promise<PrivacySettingsResponse> {
  const response = await apiClient.patch<PrivacySettingsResponse>('/users/me/privacy', patch);
  return response.data;
}
```

Both types already exist in `@forjd/contracts`. Extend the existing
`'apiClient - profile reads and writes'` describe block.

**Step 6 — `app/privacy.tsx`.** Shared `Header title="Privacy Settings"` → `/profile`. Tab bar
shown, Profile lit. Structure is `Header` → scroll → **pinned CTA bar** → `TabBar`, so Save stays
visible above the tab bar (§6.1). Copy verbatim from §6.2 — note **"Analyse"** (British spelling, as
the prototype has it) and the em dashes. Five rows:

| Row title | Contract field |
|---|---|
| Appear on city leaderboards | `leaderboardOptIn` |
| Use approximate location | `locationForLeaderboard` |
| AI insights | `aiFeaturesConsent` |
| Public profile | `publicProfile` |
| Crash diagnostics | `crashDiagnostics` |

Initial state from `getMe()`'s `privacy` object — there is deliberately no `GET /users/me/privacy`
(one read, one source of truth). **§6.4's defaults describe the prototype's local state, not the
server's**: real accounts start all-off. Render what the server returns.

Then `Permissions` and three rows — the middle one is the row the handoff doc undercounts (§9
discrepancy #5, do not drop it):
- **Location permission** — `Icon name="pin"` → `/location?back=privacy`. This makes Phase H's param real.
- **Preview my public profile** — `Icon name="profile"`, inert.
- **Download my data** — `Icon name="shield"`, inert.

Footnote card: `Icon name="shield"` at 18px plus the "Turning off AI insights…" text. Save:
`updatePrivacy()` with all five flags → `toast.show('Privacy settings updated')` →
`router.replace('/profile')`. Same `saving`/`saveError`/`loadError` handling as every screen since
Phase G, **including the load-rejection handler Phase H's review caught missing** — a `getMe()`
rejection must show an inline error, not leave a permanently blank screen.

**Step 7 — wire and tighten.** Add `onPress` to the two inert rows in `(tabs)/profile.tsx`'s
"Privacy & permissions" group (`router.replace('/privacy')`, `router.replace('/notifs')`), matching
how G/H wired Units and Goals. Drop the now-unnecessary `as Href` cast in `location.tsx`.

## Files

**New:** `components/toggle.tsx`, `components/toggle-row.tsx`, `components/social-auth-row.tsx`
(Part 1), `app/notifs.tsx`, `app/privacy.tsx`, `store/notification-preferences.ts`, plus tests.

**Modified:** `auth/apiClient.ts`, `app/(tabs)/profile.tsx`, `app/location.tsx`, `app/login.tsx`,
`app/signup.tsx`, `app/_layout.tsx`, `app/edit-profile.tsx`, `app/units.tsx`, `app/goals.tsx`,
`components/press-feedback.ts`, `tailwind.config.ts`, `package.json`.

**Reused as-is:** `components/tab-bar.tsx`, `header.tsx`, `toast.tsx`, `screen-background.tsx`,
`theme/tokens.ts`, `auth/failure.ts`. All needed glyphs (`clock`, `pin`, `shield`, `profile`,
`bell`) already exist in `icon.tsx` — only Google/Apple are new.

## Tests

Mirror `units.test.tsx` and `location.test.tsx`: `SafeAreaProvider` wrapper with fixed
`initialMetrics`, mocked `expo-router` and `@/auth/apiClient`, module-scope `ME` fixture.

- **`toggle` / `toggle-row`** — on/off geometry, and that pressing anywhere on the row (not just the
  track) toggles it. That last one is the regression test for the accessibility deviation and should
  fail against a track-only implementation.
- **`notifs`** — copy renders; defaults match spec with Leaderboard moves off; toggling persists
  through the store; **state survives a remount** (proves persistence, not just local state);
  `Change` fires the toast and nothing else; back navigates to `/profile`.
- **`privacy`** — renders from server state, not prototype defaults; all three permission rows
  present (the discrepancy-#5 guard); parent-off cascades child off; child-on turns parent on; Save
  sends all five flags and navigates; toast; inline error on save failure with no navigation; inline
  error on load failure rather than a blank screen; the two inert rows do not navigate.
- **Navigation tests go one assertion per file** — `profile-navigation-privacy.test.tsx`,
  `profile-navigation-notifs.test.tsx`, `privacy-navigation-location.test.tsx`.
  `expo-router`'s testing-library keeps navigation state across `it()` blocks, so a second test in
  the same file does not reliably start from `/profile`; this is documented at the top of
  `profile-navigation-edit-profile.test.tsx`. Do not add a second `it()` to an existing one.

## Verification (both PRs)

1. `TZ=UTC pnpm --filter @forjd/mobile test --ci --watchAll=false`, then `typecheck` and `lint`.
2. Confirm the production iOS bundle still compiles through the running Metro server — Jest does not
   compile NativeWind or native modules, and AsyncStorage is a new native dependency, so this is what
   catches a bundling break.
3. **Walk it in Expo Go on a device** (`exp://<LAN-IP>:8081`). Web preview is unavailable for
   authenticated screens (see Orientation). Specifically confirm by hand, since no unit test can:
   the Save-button glow now matches the auth CTAs; swiping back from a deep screen no longer lands on
   `welcome`; the social row renders correctly on both auth screens; toggle geometry and the three
   permission rows on `privacy`.
4. Dispatch `react-reviewer` over the changed files and act on what it surfaces.
5. Checkpoint each PR: update `roadmap.md` + `slice-2-plan.md` → PR → CI green → merge → confirm CI
   green on `main`.
