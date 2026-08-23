# Roadmap

Full phase-by-phase plan, decisions, and risk register:
`C:\Users\Mostafa Ashraf\.claude\plans\c-users-mostafa-ashraf-downloads-forjd-sleepy-hammock.md`

This file is a living summary kept in sync with that plan as phases
complete or get re-planned — the plan file is the detailed source, this is
the quick-reference for "what phase are we in and what's next."

## Current status (last updated 2026-08-23)

**We are inside Phase 1.** Phase 0 is complete except Spike B, which is open but
does not gate Phase 1 (see "Spike status" below). Read this section first when
resuming — it says exactly what's done, what's blocked on a manual step, and what
to do next. Don't re-derive this from scratch; verify it's still accurate and
continue.

### Mobile framework pivot: Flutter → Expo React Native

**`apps/mobile` is Expo (React Native) + TypeScript, not Flutter.** The Flutter
app described throughout the rest of this Phase 1 section (design tokens, Drift,
go_router, the 69-test suite) was deleted and replaced in the same change — see
**ADR-013** (`docs/decisions/ADR-013-expo-react-native.md`, supersedes ADR-001)
for the full reasoning: Expo Go's zero-build, hot-reload preview on a physical
iPhone from a Windows dev machine beats Flutter's Codemagic → TestFlight loop for
the screen-heavy phase of work the design handoff opened up. **ADR-014**
(`docs/decisions/ADR-014-openai-inbody-vision.md`, supersedes ADR-006 on vendor
choice only) rides along with it: InBody photo extraction moves to OpenAI vision
instead of Claude vision, since the pivot prompted standardizing on one AI vendor
for the app. Spike B's pipeline shape and confirmation-gate requirement are
unchanged; it still hasn't been run under either vendor. ADR-007, ADR-010, and
ADR-011 were amended (not replaced) to carry their reasoning over to the new
stack — see each ADR for what changed mechanically (Dio → axios,
`flutter_secure_storage` → `expo-secure-store`, Codemagic → EAS Build, etc.).

**Slice 1 of the Expo rebuild — auth + 5-tab shell, wired to the real backend,
test-first — is done.** This is the direct replacement for what the "Slice 11 —
Mobile auth UI" entry below describes; that Flutter work is superseded, not
current. The new slice was built RED→GREEN per phase (navigation shell, then auth
flow) against the actual NestJS `/api/v1/auth/*` endpoints, with `expo-secure-store`
token persistence and the same three-client (public / refresh / api) pattern with
refresh-dedup that ADR-011 established for Flutter. **117 tests passing across 37
suites** in `apps/mobile` (Jest + `@testing-library/react-native`), `typecheck` and
`lint` clean, and both the iOS and Android bundles compile (~9.6 MB each, zero
unresolved modules). CI's `mobile` job now runs `typecheck`, `lint`, and
`test --ci` for real (see `.github/workflows/ci.yml`) rather than the Phase-2
install-only stub.

**The Expo SDK is pinned to 54, not the latest.** Expo Go on the App Store ships a
single SDK version, and scanning an SDK-57 bundle with Expo Go 54 fails outright
with a version error. Since ADR-013's entire justification is the zero-build
Expo Go loop on a physical iPhone, the app follows whatever SDK Expo Go ships.
Downgrading surfaced one real API break worth remembering: `expo-router@6` (the
SDK 54 line) does not re-export `ThemeProvider`/`DarkTheme`/`DefaultTheme` — those
come from `@react-navigation/native` directly — while `Redirect` does still come
from `expo-router`. `jest.config.js` also sets `testTimeout: 30000`, because
`renderRouter()` rebuilds the whole route tree per call and overruns Jest's 5 s
default once workers contend for CPU.

**Design fidelity and a code review were both run against slice 1, and their
findings fixed.** The design was implemented against the runnable prototype
(`FORJD mobile app design/FORJD Mobile.dc.html`), *not* the handoff markdown —
the markdown paraphrases and was caught contradicting it outright (it gives the
login headline as "Log in"; the prototype and screenshots both say "Welcome
back"). A full audit then found 17 further gaps, all now closed. The ones worth
carrying forward as lessons:

- The app-wide **"ember" atmosphere** — `radial-gradient(130% 90% at 50% -10%,
  rgba(233,113,47,.20), #101011 55%)`, an orange glow from above the top edge — is
  the design's default on *every* screen, set in code (`atmosphere ?? 'ember'`)
  rather than in any screen's own styles. Transcribing the flat background token
  alone silently dropped it. It is now a shared `ScreenBackground` component
  (SVG `RadialGradient`, since `expo-linear-gradient` cannot do radial).
- There are **two darks**, and picking the wrong one is invisible in code review:
  `#08090A` is *"the desk, not the screen"* (outside the phone frame) and
  `#101011` is the screen itself. Three screens used the desk colour.
- **Safe-area insets** were absent app-wide; the prototype's 52 px status-bar row
  had been approximated with a hardcoded `pt-16`.
- The icon set was previously assumed not to exist and shipped as placeholder
  dots. **The full 22-glyph SVG path data is inline in the prototype** and is now
  transcribed into `src/components/icon.tsx`, verified path-by-path.

**Contract change — `sex` narrowed to three values.** `sexSchema` was
`male | female | other | prefer_not_to_say`; it is now
`male | female | prefer_not_to_say`, matching the three chips the prototype
actually draws (Male / Female / Rather not say). `other` had no chip at all, so a
stored `other` would have rendered nothing selected and been unreachable from the
UI. Narrowing was cheap and needed no migration because `sex` is a nullable
`text` column, not a Postgres enum (`profiles.schema.ts`). The compiler then
caught a **duplicate `Sex` type in `@forjd/domain`** that still carried the old
value — the two are now aligned, and that duplication is worth remembering as a
place where drift hides. Fixtures regenerated (content unchanged; the sample uses
`"female"`), API builds clean, 52 API tests still pass.

**Known open item, needs a human:** `eslint-plugin-react-hooks` is installed and
imported in `apps/mobile/eslint.config.mjs`, but its rules are not registered —
the ECC `config-protection` hook blocks edits to ESLint configs, and disabling a
protection hook is not a change to make unattended. Nothing enforces
`rules-of-hooks` / `exhaustive-deps` until this lands. The rules were verified to
pass cleanly against a throwaway config, so registering them is green work, not a
cleanup. See the PR description for the exact diff needed.
Slices 2-8 of the Expo rebuild (profile/settings, exercise library, live workout
+ offline sync, programs, InBody + AI module, real home/progress, ranking/
subscriptions) are sequenced but not built — see §9 of the mobile-pivot plan
(`C:\Users\Mostafa Ashraf\.claude\plans\i-have-added-the-declarative-cake.md`) for
the slice/screen/dependency breakdown; it is not duplicated here.

**Everything below this point that discusses the Flutter app** (design tokens,
Drift, go_router, the 69/60-Flutter-test counts, the emulator walk, the "All 14
slices" table's mobile-shaped rows 9-14) **is historical record of Phase 1 work
that has since been superseded by the pivot above**, kept for the reasoning it
captured rather than as a description of what's in `apps/mobile` today.

### Phase 1 progress

Executing the 14-slice plan. **Slices 1-11 are done and merged; `main` is green.** The
app has been walked end to end on an Android emulator against the live API — see "The
emulator walk" below.

Between slice 11 and slice 12, a **four-slice hardening batch (A-D)** ran and is merged —
see "Slices A-D" below. It was not in the original 14-slice numbering; it came from a
critical re-read of the roadmap that found the highest-leverage work in the repo was
unblocked and undone, while slices 12-14 were blocked on decisions rather than only on
accounts.

**The environment topology assumed by slice 12 no longer holds.** Only two Supabase
projects are available, not three, and Railway is rejected on cost — ADR-009 chose it
*for* its paid tier, so the decision needs retaking, not redirecting. Slices 12 and 13 are
therefore **blocked on a decision, not only on an account**: see "Next, in order" below for
the options.

Half of the phase's definition of done is already mechanically true: exactly one
file imports the Supabase SDK for auth, one for storage, and nothing else —
verified by grep in CI rather than by discipline.

**Current test surface:** 52 API unit tests, 12 API e2e tests, 69 Flutter tests, all
passing, with real coverage floors enforced in CI for the first time (see slice C). Lint,
format, `flutter analyze`, and the architecture-conformance check are green. CI now builds
a *release* APK with a size budget, not a debug one — see slice C for what that does and
does not catch.

### Slice 11 — what it turned out to be

Slice 11 grew beyond "mobile auth UI" because the imported
[FORJD Mobile design](https://claude.ai/design/p/6dd27911-0e14-43cb-bebd-8c673fa83641)
is dark and typography-led while the app was on a green-seed Material 3 theme, and
because two of its screens asked for API surface that did not exist. Three scoping
decisions were taken deliberately:

1. **Design tokens land before the screens**, plus the full five-tab navigation shell.
   Building slice 11's screens against the old theme would have meant building them twice.
2. **`registerRequestSchema` gains an optional `displayName`**, so the design's "Full name"
   field is honoured server-side rather than discarded.
3. **`POST /auth/forgot-password` is real**, backing the design's "Forgot password?" link.

Landed, each its own commit, everything green at each step:

| Step | Status | Detail |
|---|---|---|
| A1 — `displayName` at register | ✅ Done | Optional in the contract (rule 7), written to `profiles` rather than provider metadata so there is one system of record for the name. |
| A2 — `POST /auth/forgot-password` | ✅ Done | 202 with an empty body whether or not the address exists. `AuthProvider.requestPasswordReset` returns `void` so no implementation *can* leak the difference; the Supabase adapter swallows GoTrue's "user not found" into a log line; the audit row uses a null user id so latency does not reintroduce the enumeration channel. Throttled to 3 per 15 minutes. |
| B1 — Design token layer | ✅ Done | `AppColors` / `AppText` / `AppDimens` plus a rewritten dark-only `AppTheme`. `ColorScheme` written out, never seeded. **`AppTheme.light` deleted.** CSS `em` letter-spacing converted to logical pixels with the arithmetic in comments. |
| B2 — Archivo bundled | ✅ Done | SIL OFL 1.1, licence committed alongside. Bundled rather than `google_fonts`: no third-party network call to render a login screen. Only a variable face is published upstream, so weight moves through the `wght` axis — use `AppText.weighted`, never a bare `copyWith(fontWeight:)`. |
| B3 — Widget library | ✅ Done | Button, text field, labels, list row, chips, header, brand marks, tab bar. Icons keep the design's SVG path data and are stroked in a `CustomPainter` via `path_drawing`; a test parses all 24 rather than trusting transcription. |
| C2 — Network layer | ✅ Done | Three Dio clients (public / refresh / api), `ApiFailure` mapping, and the 401 → refresh → replay interceptor. Concurrent 401s share one in-flight future, so N of them cause exactly one refresh. |
| C1 — Auth models + controller | ✅ Done | Sealed `AuthState` (five variants), `SecureTokenStore`, `AuthRepository`, `SessionRefresher`, `AuthController`, `main.dart` port overrides. |
| C3 — Auth screens + router gate | ✅ Done | Welcome/login/register/forgot-password, redirect via `refreshListenable`, `_Placeholder` deleted and `widget_test.dart` rewritten in the same commit. |
| 8 — Shell + tab bar wiring | ✅ Done | `StatefulShellRoute.indexedStack`, five branches, four honest placeholder tabs. |
| 9 — Profile + edit profile | ✅ Done | `GET /users/me`, `PATCH /users/me/profile`, `appDatabaseProvider`, Drift-cached display name as the in-flight fallback. |
| 10 — ADR-010, ADR-011 | ✅ Done | `docs/decisions/ADR-010-mobile-design-system.md` and `ADR-011-mobile-session-lifecycle.md`. |

**One bug worth remembering, found by a test rather than in the field:** replaying a
request through the interceptor's own Dio deadlocks. `QueuedInterceptor` serialises its
callbacks, so the replay queues behind the `onError` that is awaiting it and the request
hangs until it times out. The replay client must not carry the interceptor.

### Slices A-D — hardening between slice 11 and slice 12

Four slices, each its own PR, each merged with `main` green afterward (PRs #7-#10). Not
part of the original 14-slice numbering — they came out of re-reading the roadmap
critically rather than executing the next listed slice by default.

| Slice | Status | Detail |
|---|---|---|
| A — testability seam + index + baseline | ✅ Done | `SupabaseAuthProvider` now takes an injected Supabase client (`SUPABASE_AUTH_CLIENT`), so the weak-password passthrough, the enumeration-defence collapse, and the password-reset swallow are unit-tested for the first time — 8 new tests, closing an ADR-011 gap that had stood since slice 11. `audit_logs.user_id` indexed (migration `0002`) — the unindexed FK was sequential-scanning the fastest-growing table on every `ON DELETE SET NULL`. `scripts/perf/measure-auth-latency.ts` added so slice B could be argued from a number. |
| B — local JWT verification | ✅ Done, **ADR-012** | `verifyAccessToken` verifies in process against the project's published ES256 keys instead of calling Supabase. Measured on `GET /users/me`: p50 **123.3 ms → 14.3 ms**, p95 **253.1 ms → 20.7 ms**. `IdentityCache` removes the remaining per-request DB read, bounded and keyed on external id **and** email so a re-pointed address still re-enters the repository's ownership check. 10 tests sign real tokens with a throwaway key, including both `alg: none` and the HS256-signed-with-the-public-key confusion attack. **The tradeoff is real and stated in the ADR**: an access token can no longer be recalled before it expires, so the token lifetime is now the revocation window — see the manual steps below, this is not finished until it is shortened. Walked on the emulator afterward; nothing broke, nothing new found (see below). |
| C — real CI gates | ✅ Done | The repo has claimed 80% coverage since Phase 1 and enforced nothing. Now enforced: API `coverageThreshold` (43% general pool, **100% floor on `auth/guards/**` and `auth.service.ts`**), a Flutter lcov floor (75%), a release-APK size budget (+5% of measured), and a conformance grep pinning `flutter_secure_storage` to `secure_token_store.dart`. Every gate was watched to fail against a planted violation before being committed. CI now builds a **release** APK, not debug — the debug build ran no AOT compilation and no tree-shaking, so it could not have caught a size regression. **Correction to the original plan**: a release build does not exercise R8 — Flutter does not enable minification by default, confirmed by inspecting the dex — so enabling it is deferred to its own slice pending a device walk. `cupertino_icons` dropped (546 bytes; genuinely unused). `uses-material-design` stays `true`: the icon set has no eye or pencil, and Material Icons tree-shakes to 2,212 bytes, so the honest cost of keeping it is 2 KB, not 1.6 MB. |
| D — contract-drift fixtures | ✅ Done | The Dart DTOs mirror the Zod contracts by hand and nothing checked they agreed — flagged as an open follow-up since slice 11. `packages/contracts/src/fixtures.ts` now defines one example per response shape, each validated by its own schema before being written to `packages/contracts/fixtures/*.json`; a Dart test parses those exact files through the real DTOs. CI regenerates the fixtures and fails on any diff. **Correction to the original plan**: it called for capturing real e2e response bodies as fixtures, which would have committed a live access token to the repo on every run; invented, schema-validated values are used instead — safer, and a tighter check, since the awaiting-confirmation and empty-profile cases were chosen deliberately rather than left to whatever a run happened to produce. Verified both directions: a renamed contract field produced `Expected: 172.5, Actual: null`; a deleted fixture failed the parser-coverage test. |

Two corrections to the plan surfaced only by doing the work, both recorded above rather
than silently absorbed: the release-build size gate does not imply R8 is running, and the
fixture strategy changed from "capture live" to "generate from schema" once the security
cost of the first approach became concrete.

### The emulator walk

The UI was walked on a Pixel 7 / Android 14 emulator against the local API and live
Supabase. It is worth doing again after any UI change — it found four things the 58 tests
passing at the time did not.

**The emulator already exists.** Do not re-derive this:

```bash
# AVD: forjd_pixel7_api34  (Play Store image, so Health Connect works on it in Phase 6)
/c/Android/Sdk/emulator/emulator.exe -avd forjd_pixel7_api34 -no-snapshot-load -gpu host
```

`-gpu host` matters. The default software renderer ANR'd the emulator's own SystemUI at
1080x2400 before the app could be used. Drive it with `adb shell input tap|text` and read
the result with `adb exec-out screencap -p`; the package is **`com.forjd.forjd`**. No app
config is needed — `apiBaseUrl` already defaults to `http://10.0.2.2:3000/api/v1`, which is
the emulator's alias for the host. A physical phone would need the machine's LAN IP instead.

**Confirmed working on device:** register with a name → session → app; the name surviving to
`/users/me`; all five tabs; profile initials fallback; edit → save → `PATCH` persisting
server-side; wrong credentials keeping the user on the form; the reset panel revealing
nothing about whether an account exists; logout clearing the device; and a cold restart
while signed in going straight to `/home` with no welcome-screen flash. It also exercised
the weak-password passthrough, which ADR-011 records as having no automated test.

**Found and fixed** (PR #3): a stale failure greeting the next form opened; a field error
persisting while being corrected; the contract accepting a space as a symbol when Supabase
does not; and the Flutter-default white launch screen flashing on every cold start of a
dark app. The space-as-symbol bug was introduced earlier in the same session that fixed the
password policy — only typing into a real form exposed it.

**Found and left alone**, because each is a judgement call rather than a defect:

- `AppColors.errorText` (`#E05A3C`) sits close to the accent, so "Invalid credentials" reads
  a little like the "Forgot password?" link above it. Changing it means changing the design's
  palette.
- There is no `calendar` icon among the 24, so the birthday field uses `clock`. Fixing it
  means adding a path to the icon set.
- `applicationId` is `com.forjd.forjd` — the doubled segment is Flutter's default org+project
  naming. Slice 12's flavors have to set this anyway; fix it there.
- The launcher icon is still the default Flutter icon.

**What an emulator still cannot cover**, and why the phone is not optional: no real health
data (Phase 6), a software-backed keystore rather than hardware, no WHOOP device (Phase 7),
a synthetic camera for InBody capture (Phase 5), and no sense of using the app mid-set in a
gym. Rule 16 and ADR-007 both assume real hardware for health work.

### Deviations from the design, decided rather than drifted

The design shows things the API cannot yet support. Each was a deliberate call, not an
oversight, and each is a follow-up rather than a silent omission:

- **`@username`** — no column, no uniqueness policy, no availability endpoint. Omitted; the
  profile screen renders the user's email in the handle slot instead.
- **Profile stat tiles** (147 Workouts / 9 This Month / #47 City Rank) — no data source until
  Phases 3 and 6. Omitted entirely rather than rendered as zeros, which would read as a bug.
- **Avatar upload** — `avatarUrl` is in the contract but `StorageProvider` stays unconsumed
  until Phase 5. Initials in the tile, no upload affordance that does nothing.
- **`heightCm` and `unitSystem`** — editable in the API, absent from the design's edit screen.
  Left out for now, which means `unitSystem` stays `metric` until the first Phase 3 screen
  that shows a weight forces the conversation.
- **Sex chips** — the design draws three, `sexSchema` has four values. Rendering four, so
  `other` is not a value the API accepts but the UI can never produce.
- **Password reset is only half a flow** — `resetPasswordForEmail` sends a link; *completing*
  the reset needs a deep link plus `POST /auth/reset-password`. The mobile screen ends at
  "Check your email" and the user finishes in a browser. **This is the largest known gap.**
- **Email-confirmation state** — the design has no such screen, but `registerResponse.session`
  is nullable and `forjd-dev` returns null. The "check your inbox" panel is an addition to
  the design, not an implementation of it.
- **Input focus ring** — the design specifies none. A 1px accent border was added, because an
  invisible focus state is an accessibility regression.

### Password policy: mirrored in the contract, and partly surfaceable

Walking the flow against live Supabase found a dead end. The project enforces a password
complexity policy (lower + upper + digit + symbol); `registerRequestSchema` required only
`min(8)` and the signup hint said "Min. 8 characters". A password that satisfied our contract
and matched our own hint came back as a bare 401 "Registration failed".

Two rules came out of fixing it:

1. **`registerRequestSchema` mirrors the provider's policy**, and **the symbol class must match
   Supabase's exact set** — not a broad `[^A-Za-z0-9]`. A space satisfies the broad class and
   not Supabase's, so `"Str0ng Pass1"` passed our validation and was rejected by the provider.
   That was caught by typing it into the real form, not by any test. A rejection is then a
   400 naming the field. If the policy changes in the Supabase dashboard, change it here
   too — the duplication is deliberate, and drift between them is what caused both bugs.
2. **Login keeps `min(1)`, permanently.** Applying a current policy to an existing password
   locks out everyone whose password predates it. An e2e test pins this: a policy-shaped
   password at login must fail on credentials (401), never on validation (400).

And one correction to the enumeration defence: `SupabaseAuthProvider.reject()` collapsed
*every* `signUp` error into one message. That is right for "user already registered", which is
an enumeration vector, but wrong for a weak password — that reveals nothing about whether an
address has an account, so hiding it protected nobody. Password-policy failures now pass
through as a 400; everything else stays generic.

**Not covered by a test:** the adapter's weak-password passthrough itself. `SupabaseAuthProvider`
builds its client in the constructor via `createClient`, so there is no seam to inject a stub
through. It was verified by hand against the live project; making it testable means a
constructor-injectable client, which is a small refactor nobody has needed yet.

### Follow-ups opened by slice 11

- Password-reset **completion**: deep link + `POST /auth/reset-password`.
- Per-email rate limiting on forgot-password. `ThrottlerGuard` keys on IP, so today it caps
  an origin, not an address; Supabase's own per-address limit is the only real backstop.
- Username/handle, avatar upload (Phase 5), profile stat tiles (Phases 3/6).
- ✅ **A real coverage gate — done.** `coverageThreshold` in `apps/api/package.json` and
  `scripts/ci/check-flutter-coverage.sh`, both wired into CI and both shown to fail against
  a planted violation. The floors are set at what the suites measure today (API 43% on the
  general pool with a separate **100% floor on `auth/guards/**` and `auth.service.ts`;
  Flutter 75%) rather than at the stated 80%, because a threshold chosen for how it sounds
  fails on the day it lands and is deleted the day after. Raise them deliberately.
  The API figure reads lower than the API really is: controllers and services are covered by
  the e2e suite, which runs as a separate jest project and contributes no coverage data.
  **Merging the two runs' coverage is the next real improvement here.**
- ✅ **Contract-drift check — done (slice D).** Generated fixtures, schema-validated, parsed
  through the real Dart DTOs in CI. Full codegen (Zod → Dart) remains a further step, not
  attempted here — worth revisiting once the contract passes roughly 20 types.
- ✅ **Conformance grep pinning `flutter_secure_storage` to `secure_token_store.dart` — done**,
  and verified both ways: it catches a planted import elsewhere and allows the legitimate one.
- Golden tests. Deliberately skipped: `flutter test` substitutes Ahem for bundled fonts, so
  goldens need an explicit `FontLoader` — a separate decision (ADR-010).
- Three icons the set does not have: `calendar` (the birthday field uses `clock`), plus
  `eye` and `pencil`. The last two are why `uses-material-design` is still `true` — the
  password-visibility toggle and the edit affordance are Material glyphs. Worth knowing before
  anyone treats that as waste: Flutter subsets the icon font to the codepoints actually used,
  and the release build tree-shakes MaterialIcons from 1,645,184 bytes to **2,212**. Drawing
  the three icons is a design task, not a size optimisation.

- **R8 is not enabled**, so the release APK is unminified. Flutter does not turn on
  minification by default, and the CI size gate measures the build as it actually is
  (20,861,242 bytes, single-ABI arm64). Enabling `isMinifyEnabled` would shrink it and make
  it harder to reverse-engineer, but Drift, `sqlite3_flutter_libs` and
  `flutter_secure_storage` all need keep rules that can only be trusted after a device walk —
  so it is a deliberate slice of its own, not a flag to flip. Re-baseline the size budget when
  it lands.
- The launcher icon is still the default Flutter icon.
- `AppColors.errorText` (`#E05A3C`) sits close to the accent, so an inline error reads a
  little like a link. A palette decision, deliberately not taken unilaterally.
- ✅ **Weak-password-passthrough test — done (slice A).** The Supabase client is now
  injected (`SUPABASE_AUTH_CLIENT`), giving a stub seam; 8 tests cover the passthrough, the
  enumeration collapse, and the reset swallow.

### All 14 slices

| Slice | Status | Detail |
|---|---|---|
| 1 — NestJS scaffold | ✅ Done | `apps/api` on NestJS 11, global `/api/v1` prefix, pino logging, Sentry inert without `SENTRY_DSN`. `GET /api/v1/health` verified 200; unprefixed `/health` returns 404. |
| 2 — Drizzle + Postgres | ✅ Done | `drizzle.config.ts`, `DatabaseModule` exposing `DRIZZLE`/`PG_POOL` tokens, pool closed on shutdown. Health endpoint reports `{status:'ok',database:'up'}` against the docker-compose Postgres. `db:generate`/`db:migrate`/`db:studio` wired. |
| 3 — Provider interfaces + ADR-008 | ✅ Done | `AuthProvider` and `StorageProvider` interfaces written; **ADR-008 created and now Accepted** — it did not exist before, ADR-003 only carried a placeholder. `domain-model.md`, `integrations.md`, ADR-003 updated to point at it. |
| 4 — Auth & profile slice | ✅ Done | `users`/`profiles`/`audit_logs` migrations; `@forjd/domain` + `@forjd/contracts` packages (Zod-backed wire contracts); `SupabaseAuthProvider`; `AuthService`/`AuthController` (`register`/`login`/`refresh`/`logout`); `JwtAuthGuard`; `UsersRepository`/`Service`/`Controller` (`GET /users/me`, `PATCH /users/me/profile`). **Verified live against Supabase** — registration created the user, mapped `supabase_user_id`, auto-created the profile, and wrote the audit row. |
| 5 — StorageProvider impl | ✅ Done | `SupabaseStorageProvider` + `StorageModule`, bound but deliberately unconsumed until Phase 5. The `inbody` bucket exists and responds. |
| 6 — Remaining migrations | ✅ Done | `goals`, `preferences`, `feature_flags` as migration `0001`. Schema only — no endpoints, since Phase 1's scope is profile view/edit. |
| 7 — CI lint/test | ✅ Done | `.github/workflows/ci.yml` with `api` (Postgres service container) and `mobile` jobs. Not yet exercised on GitHub — no push made. |
| 8 — CI conformance grep | ✅ Done | `scripts/ci/check-architecture-conformance.sh`. **Verified non-vacuous**: catches a planted Supabase import outside the provider dirs, allows the same import inside them. |
| 9 — Flutter shell | ✅ Done | `flutter create` scaffold + go_router routes, Riverpod, Dio client, theme. Analyzer clean, tests pass. |
| 10 — Drift scaffold | ✅ Done | `AppDatabase` with a `CachedProfiles` table. Timestamps stored as **ISO-8601 text**, not Unix seconds — the default returns local time and silently shifts any instant that crossed a timezone. See `apps/mobile/build.yaml`. |
| 11 — Mobile auth UI | ⬜ **Superseded** | Was merged as Flutter (PRs #2, #3): design tokens + Archivo, widget library, 401→refresh→replay network layer, auth screens, 5-tab shell, profile/edit-profile, ADR-010/011. Walked on an emulator; four findings fixed; 60 Flutter tests; debug APK builds. **The Flutter app this built no longer exists** — see "Mobile framework pivot" above. Its replacement is the Expo rebuild's **Slice 1** (auth + 5-tab shell, wired to the real backend, test-first, 35 tests), done under ADR-013. |
| 12 — Build flavors | ⬜ Blocked on a decision | Written against the Flutter app; needs re-scoping for Expo (EAS Build profiles rather than Flutter flavors) once reached. The underlying blocker is unchanged: the plan assumed three Supabase projects, only two are available, and Railway is rejected on cost. Needs a topology decision (see "Next, in order"), not only an account. |
| 13 — Staging deploy | ⬜ Blocked on a decision | ADR-009's host choice (Railway) no longer holds — it was chosen partly *for* its paid tier. Needs a free-tier host picked and verified before an ADR can supersede it. |
| 14 — Device DoD walk | ⬜ Not started | Needs 12/13 plus the physical Android device. |

Phase 1's definition of done is unchanged: register → login → refresh → logout →
view/edit profile against the deployed staging API from the physical device, with
no file outside `apps/api/src/auth/providers/` importing the Supabase SDK.

### Deferred deliberately from the Phase 1 review

Two review findings were judged as tradeoffs rather than defects, and are tracked here
rather than silently dropped.

**Token verification is uncached.** ✅ **Resolved — see ADR-012.** Tokens are now verified
in process against the project's published ES256 signing keys. Measured on the cheapest
authenticated endpoint, p50 went from 123.3 ms to 14.3 ms and p95 from 253.1 ms to 20.7 ms.
The decision was taken the way this entry asked for it: with a measurement first, and with
the cost written down. That cost is that an access token cannot be recalled before it
expires, so **the access-token lifetime is now the revocation window** — currently 3600 s
and needing to be set to 900 s in the Supabase dashboard. That manual step is listed below
and ADR-012 is incomplete until it is done.

**RLS is enabled on no table.** Acceptable today because nothing except the API holds a
Postgres credential — the mobile app has no Supabase client, and the CI conformance check
structurally prevents one appearing. It stops being acceptable the moment either the
storage adapter hands clients signed URLs (Phase 5) or any client gets a direct Supabase
key. **Gating rule: enable RLS before any client receives a Supabase credential.**

One more, unfixable here: `drizzle-kit` pulls a transitive `esbuild` advisory. Dev
dependency only, never shipped, and resolvable when drizzle-kit updates.

### Two findings from the live Supabase environment

**Email confirmation is on in `forjd-dev`** (`mailer_autoconfirm: false`). Registration
therefore creates the account but issues no session, and the subsequent login fails with
"Email not confirmed" until the emailed link is clicked. This is correct production
behaviour and the API models it honestly — `signUp` returns a nullable session rather
than pretending one exists. But it makes the dev loop awkward: every test account needs a
real inbox. Consider turning "Confirm email" off in the **dev project only**
(Authentication → Providers → Email). Staging and prod are separate projects, so dev
convenience costs production nothing.

**The direct Postgres connection is unreachable from this machine.**
`db.<ref>.supabase.co` resolves only to IPv6, and this network has no IPv6 route — the
router hands out ULA (`fd8c:…`) addresses with no upstream. Use the **Session pooler**
string (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432`), which is IPv4. Session
mode, not transaction mode: drizzle-kit migrations need prepared statements. This blocks
nothing today because migrations run against local Postgres first by design (ADR-002); it
matters when the hosted database is first migrated in slice 13.

### Repo

- Skeleton created at `C:\Users\Mostafa Ashraf\Desktop\FORJD`: `CLAUDE.md`,
  all 7 ADRs, `docs/product/*`, `docs/architecture/*`, root config
  (`.gitignore`, `pnpm-workspace.yaml`, `docker-compose.yml`, `README.md`).
- ✅ **Committed and pushed** to https://github.com/Menshawy97/FORJD.
  Local git identity is set per-repo (`--local`) to Mostafa Menshawy /
  mostafa.menshawy97@gmail.com. All commits are authored under that identity —
  keep it that way; do not add other co-authorship trailers.
- `apps/api` and `apps/mobile` both have real, tested application code now (see
  "Current status" above) — this line describing them as empty placeholder
  directories was a stale carryover from the repo's very first skeleton commit,
  left uncorrected through an earlier exploration pass, and is corrected here.

### Toolchain — installed and verified on this machine

| Tool | Status | Detail |
|---|---|---|
| Node.js | ✅ Done | v24.19.0 LTS via winget |
| pnpm | ✅ Done | v11.22.0 via `npm install -g` (corepack was blocked by non-admin `Program Files` write — worked around, don't re-attempt corepack) |
| GitHub CLI | ✅ Done | v2.97.0 via winget |
| git long paths | ✅ Done | `git config --global core.longpaths true` |
| Flutter | ✅ Done | 3.47.0 stable / Dart 3.13.0, cloned to `C:\dev\flutter`, on User PATH, analytics disabled |
| Android Studio | ✅ Done | App installed via winget. SDK GUI wizard was skipped — provisioned headlessly instead (see below) |
| Android SDK | ✅ Done | At `C:\Android\Sdk` (moved from the default `%LOCALAPPDATA%` path because it contained a space in the Windows username, which breaks NDK tooling). platform-tools, `platforms;android-34`, `platforms;android-36`, `build-tools;36.0.0`, all licenses accepted. `flutter config --android-sdk` points at it. |
| `flutter doctor` | ✅ Clean | Android toolchain green. Only remaining flag is "Visual Studio not installed" — **ignore this**, it's for Windows desktop apps, not a FORJD target platform. |
| Docker Desktop | ✅ Done | WSL2 enabled via the elevated setup script + reboot. `docker-compose up -d` brings up `forjd-postgres` (5432) and `forjd-redis` (6379), both reporting healthy. |
| Android emulator | ✅ Done | AVD `forjd_pixel7_api34` — Pixel 7, Android 14, **Play Store** image (so Health Connect works on it in Phase 6), 4 GB RAM, hardware keyboard. Launch with `-gpu host`; the software renderer ANRs SystemUI at this resolution. WHPX acceleration confirmed usable. |
| Physical Android device | ⚠️ Not connected | Needs USB with debugging enabled; `flutter devices` will pick it up. The emulator covers UI work, but not real health data, a hardware-backed keystore, WHOOP, the camera, or gym use — so this is still required before Phase 6 and for slice 14. |

### Manual steps only the user can do (genuine hard stops — need a UAC click, physical hardware, a credential, or human judgement)

Steps 1-4 of the original list (elevated setup script, reboot, Docker first-run,
git identity + initial commit) are **done**. What remains:

1. ⬜ **Plug in the physical Android device**, confirm with `flutter devices`. No longer blocks UI work — the emulator covers that — but still required for slice 14 and anything touching Health Connect (rule 16, ADR-007).
   Needed from week 1 — Health Connect is a system component and gym testing
   needs real hardware, not an emulator.
2. ⬜ **Set `ANTHROPIC_API_KEY` to run Spike B.** No credential exists on this
   machine (no env var, no `~/.config/anthropic` profile, no `ant` CLI), and an
   agent must never be handed the key — set it yourself in your own shell:
   ```powershell
   $env:ANTHROPIC_API_KEY = "sk-ant-..."
   ```
3. ✅ **`forjd-dev` Supabase project — done.** Email/password auth enabled, `inbody`
   bucket created, credentials in the gitignored `apps/api/.env`. Verified working:
   auth and storage endpoints respond, and a real registration round-tripped.
   ⬜ **Only two Supabase projects are available in total**, not three, so slice 12's
   original dev/staging/prod plan does not fit. **Pick one:** (a) create `forjd-prod` and
   run local development against the Supabase CLI Docker stack instead of a cloud project —
   frees a slot and removes the email-confirmation and IPv6-pooler friction `forjd-dev` has
   caused; or (b) create `forjd-prod` and collapse dev and staging onto the existing
   `forjd-dev` project — simpler, but staging then never matches prod's confirmation-on
   config. Either way, `forjd-prod` is the one genuinely new project needed.
4. ⬜ **Railway is declined (cost) — pick a free host instead.** ADR-009 chose Railway partly
   *for* its paid tier's absence of cold starts, so that reasoning no longer applies and the
   decision needs retaking, not redirecting. Candidates, cheapest-to-set-up first: **Render**
   free web service (no card historically required, sleeps after ~15 min idle), **Koyeb**
   free tier (comparable), **Google Cloud Run** (best technical fit — ~1-2 s cold start,
   generous free tier — but needs a card on file even at $0). Verify current terms before
   committing; ADR-009's own recorded weakness is that Railway's pricing was never checked,
   and repeating that would be the same mistake twice.
5. ⬜ **Shorten the access-token lifetime to 900 seconds** (Supabase dashboard →
   Authentication → Sessions), in `forjd-dev` and in every project created later. Since
   ADR-012 this value is the session revocation window, not a convenience setting: it is how
   long a signed-out or deleted account's token keeps working. It is 3600 s today. The mobile
   client refreshes transparently on a 401, so users notice nothing.
6. ⬜ **Hand-label Spike B ground truth.** This one is not automatable *in
   principle*, not just in practice: if the same model that extracts the values
   also writes the answer key, the accuracy number measures self-consistency
   rather than correctness — and it fails silently, looking like a clean result.
   Read each sheet yourself. See `scripts/spikes/README.md`.

### Spike status

| Spike | Status | Detail |
|---|---|---|
| A — exercise dataset | ✅ **Decided.** ADR-005 Accepted | `free-exercise-db` chosen (~870 exercises, Unlicense/public domain, zero attribution or share-alike obligations). `wger` rejected for now — its data is CC-BY-SA and the share-alike implications for a closed-source paid app are an **open legal question**; fold that into the lawyer conversation before ever ingesting wger content. `exercisedb.io` ($299+, richest taxonomy) deferred as a future paid upgrade. |
| B — InBody vision | 🟡 **OPEN — tooling built, blocked on the two manual steps above** | Harness complete and smoke-tested at `scripts/spikes/`: `inbody-vision.ts` (Claude vision → structured JSON with per-field confidence) and `score-inbody.ts` (per-field accuracy, confidence calibration, high-confidence-error count). ~20 photos are staged in the gitignored `scripts/spikes/inbody-samples/photos/`. **Nothing has been measured yet** — ADR-006 stays Proposed until it has. |
| C — iOS pipeline | ⬜ Not started | Gated on Apple Developer *organization* approval. Explicitly not a Phase 0 blocker; track as an open checkpoint through Phase 1. |

### Phase 0 items not yet started (calendar/business — only the user can act)

- Business entity registration, D-U-N-S number
- Google Play Console + Apple Developer *organization* accounts
- Legal engagement for privacy policy / ToS — **add the wger CC-BY-SA share-alike
  question to this engagement** (see ADR-005), alongside health data categories,
  InBody images, third-party AI processing, and location/leaderboard consent

### Next action once resumed

**Slices 1-11 and the A-D hardening batch are merged; `main` is green.** What is left in
Phase 1 is genuinely deployment-shaped, but two of its three remaining slices are now
blocked on a decision rather than only on an account — see the manual steps above for the
Supabase-topology and hosting choices. **Phase 2 has no blocker at all.** A re-plan of its opening slices (canonical exercise
model + ingest, browse/search API, on-device catalogue with local FTS5 search — see the
"Working method" note at the bottom of this file for why later phases are re-planned rather
than executed from the original outline) came out of the same session that ran slices A-D,
but has not yet been transcribed into this file or into the plan file linked at the top.
**Doing that transcription is itself the first useful step** if a session resumes before
the topology/host decisions above are made — do not re-derive the re-plan from scratch, and
do not start writing Phase 2 code before it is written down here.

Nothing is half-finished. Slice D closed the last item that was both unblocked and open;
there is no more free-standing hardening work sitting undone the way there was before the
A-D batch.

### Next, in order

0. **Slice 2 of the Expo rebuild — profile/settings screens + the backend behind them.**
   **In progress — Phases A and B are done and merged; Phase C is next.** Two documents
   carry it, and a resuming session should read both before touching anything:
   - **`docs/product/slice-2-plan.md`** — the approved plan: locked decisions, phase-by-phase
     build order (A–F backend, G–J mobile), verification steps, and remaining open questions.
   - **`docs/design/slice2-screen-specs.md`** — every value (copy, typography, colour,
     spacing, states) extracted from the runnable prototype for all six screens. Its header
     box records which of its own open questions have since been answered; that box wins
     over the body where they disagree.

   Scope covers `editProfile`, `units`, `goals`, `notifs`, `privacy`, `location`, plus the
   `athlete` public-profile screen. Four screens were blocked on backend fields that do not
   exist, so **the backend work is inside this slice rather than deferred** — new columns on
   `profiles` (three independent unit preferences, `training_goals`/`activities` arrays,
   `city`), a new `privacy_settings` table, and `GET /api/v1/athletes/:userId`.

   Decisions already locked (do not re-litigate): no push in Phase 1 so `notifs` is
   device-local; units are three real preferences with `unitSystem` demoted to a deprecated
   preset; handles (`@jmitch`) dropped entirely; the athlete screen ships identity only
   because its stat tiles need Phase 10 data; privacy flags all default **off**; and
   `athletes.service.ts` / `privacy.service.ts` carry a 100% coverage threshold, since the
   untested branch in an authorization decision is the one that leaks.

   Two traps worth knowing before starting. The existing **`goals` table is not these
   goals** — it models measurable targets (`target_value`, `target_date`), while the screen's
   are untargeted intents; the new thing is `training_goals`. And the handoff markdown
   disagrees with the prototype in **ten** places (e.g. `05-interactions.md` says "disabled
   does not exist in this design" while `goals` disables Save at `opacity .4`; `privacy` has
   three permission rows, not the two documented). **Trust the prototype.**

   Also unresolved: `heightCm` exists in the contract but no screen edits it, and
   `avatarUrl` has no control anywhere in the design.

   **Phase A — schema, migration, repository — is merged.** What landed:
   - `profiles` gained `weight_unit`/`distance_unit`/`energy_unit` (text, NOT NULL,
     defaulting `kg`/`km`/`kcal`), `training_goals`/`activities` (`text[]`, NOT NULL,
     default `'{}'`), and `city`/`city_slug` (nullable). All `text`, never PG enums —
     `ALTER TYPE` cannot remove an enum value, whereas narrowing a tuple in code is free,
     as the `sex` narrowing was.
   - New `privacy_settings` table: `public_profile`, `leaderboard_opt_in`,
     `location_for_leaderboard`, `ai_features_consent` (+ `ai_features_consent_at`),
     `crash_diagnostics` — every one boolean, NOT NULL, **default false**.
   - Migrations `0003_damp_luke_cage.sql` (generated) and
     `0004_backfill_privacy_settings.sql` (`--custom`, gives every pre-existing account an
     all-off row).
   - The closed value sets now live in `@forjd/domain` as `as const` tuples
     (`WEIGHT_UNITS`, `TRAINING_GOALS`, …). Phase B makes `@forjd/contracts` depend on
     domain and build its `z.enum(...)` from them, which is the fix for the duplication that
     let `Sex` drift.
   - `upsertFromIdentity` now creates user, profile **and** privacy row in one transaction;
     `PrivacyRepository.findOrCreate` is defensive on top of that, so a missing row can
     never 500 the settings screen.
   - `toProfile` filters both arrays and all three unit columns through the known-value set,
     so a future narrowing degrades to "that chip is deselected" rather than the API's own
     response failing the API's own schema.

   **The ~43%-vs-~59% coverage discrepancy was a misreading, not a real divergence.** CI's
   `test:cov` reported **59.3%** statements on the last run of `main`; `43` is simply the
   *threshold* configured in `apps/api/package.json`, set conservatively below the measured
   value. CI and local measure the same file set. Nothing to fix — the number to watch is the
   threshold, and it now has ~20 points of slack (Phase A took the measurement to ~63%).

   **A number collision to resolve before Phase F:** this document assigns **ADR-015** to the
   Supabase topology decision (item 2 below), while `docs/product/slice-2-plan.md` assigns
   the same number to the unitSystem-as-preset reversal. Whichever is written first takes
   015; the other takes 016.

1. **Pick the Supabase topology and the free host** (see manual steps above) — both are
   decisions, not implementation, and both slices 12 and 13 are stalled on them specifically.
2. **Slice 12 — build flavors**, once `forjd-prod` exists and the topology is chosen.
   `API_BASE_URL` is now an Expo `app.config.ts` `extra` value rather than a Dart
   `String.fromEnvironment`, so this becomes EAS Build profiles rather than Flutter flavors.
   Record the topology decision as **ADR-015** (013 and 014 are taken by the Expo pivot and
   the OpenAI/InBody vendor change).
3. **Slice 13 — deploy staging to the chosen free host.** Superseding ADR-009 requires
   `apps/api/Dockerfile`, which does not exist yet and needs writing (multi-stage,
   production dependencies only). Note the IPv6 finding below: use the **session pooler**
   connection string when the hosted database is first migrated, not the direct one.
4. **Slice 14 — the definition-of-done walk on the physical device**, against deployed
   staging. This is what actually closes Phase 1.

**If the topology/host decisions have not been made when a session resumes**, there is no
unblocked Phase 1 work left, and the useful default is Phase 2 — transcribe its re-plan
into this file first, per the note above, rather than starting from a blank slice.

Before starting slice 12, re-read this file and the plan's Phase 1 outline, as the working
method below requires. Phase 2 (exercise database) should be re-planned rather than executed
from the outline — later phases were deliberately left thin so earlier ones could teach their
lessons, and slice 11 taught several worth carrying forward: mirror provider-side constraints
in the contract, walk a flow live before believing it, and prefer a test that has been shown
to fail against the unfixed code.

### The slice B walk (2026-08, after ADR-012)

Token verification changed, so the walk was repeated on the same emulator. **Nothing broke
and no new findings came out of it**, which is the honest result rather than a disappointing
one — the change was server-side and the mobile client never knew.

Confirmed on device against the local API and live Supabase: register with a name → straight
into `/home`; the five-tab shell; the name reaching `/users/me` through the rewritten guard;
edit → save → `PATCH` persisting (checked in Postgres, not just on screen); a cold restart
while signed in going straight to `/home` with no welcome flash; log out returning to
`/welcome`; and a cold restart after logout staying on `/welcome`.

**Not covered, and worth being precise about:** the 401 → refresh → replay path was *not*
forced on device. Doing so needs an access token the server will reject while the refresh
token still works, and there is no way to produce one by hand — the stored token is
encrypted by `flutter_secure_storage`, and corrupting the ciphertext produces a failed
read rather than a rejected token. It is covered by `auth_interceptor_test.dart`, including
the single-flight property. The natural way to exercise it on a device is after the
access-token lifetime is shortened (see the manual steps), when it can simply be waited out.

### Re-running the slice 11 verification

This has been done once (see "The emulator walk"). Keep it as the procedure to repeat
after any change to the auth or profile UI.

```bash
docker compose up -d
pnpm install && pnpm -r build
pnpm --filter @forjd/api test && pnpm --filter @forjd/api test:e2e
bash scripts/ci/check-architecture-conformance.sh
pnpm --filter @forjd/api start:dev
```

```bash
cd apps/mobile
flutter run -d <emulator> --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

The walk that proves it: cold start → splash → welcome; register with a name → the
"check your inbox" panel; log in → `/home`; move through all five tabs and confirm each
keeps its own scroll position; profile shows the registered name; edit → save → survives
a reload; forgot-password → "check your email"; log out → `/welcome`; **kill and relaunch
while logged in → straight to `/home` with no welcome-screen flash** — that last one is
the `AuthUnknown` state doing its job.

Refresh-and-replay is invisible in a normal walk. Force it: corrupt the stored access
token, open the profile screen, and confirm **exactly one** `/auth/refresh` in the API log
followed by a successful `/users/me`. Then corrupt the refresh token and confirm the app
lands back on `/welcome`.

**Email confirmation is currently OFF in `forjd-dev`**, which is what lets register → login
be walked without a real inbox. If a walk ever shows the "check your inbox" panel instead
of signing straight in, that setting has been turned back on (Authentication → Providers →
Email) rather than something being broken. The `AuthNeedsEmailConfirmation` state and its
tests stay regardless — that is production behaviour, and staging/prod should keep
confirmation on.

Passwords must satisfy the policy: 8+ characters with an uppercase, a lowercase, a digit,
and a symbol from Supabase's set — a space does not count. `Str0ng!Pass1` works.

Spike B remains open and is worth finishing — Phase 5 is designed around its
answer — but it does not block anything in Phase 1. Set `ANTHROPIC_API_KEY`, run
`pnpm extract`, hand-label truth, run `pnpm score`, then fill in ADR-006's
Consequences table and flip its Status to Accepted (or, if confidence turns out
not to correlate with real errors, record that the confidence gate is decorative
and needs redesigning — that is a legitimate and valuable spike outcome, not a
failure).

## Timeline (~38 weeks to Android beta, dual-platform public launch)

| Phase | Weeks | Focus | Status |
|---|---|---|---|
| 0 — Setup & decisions | 1-3 | Toolchain, accounts, repo skeleton, 3 spikes, business entity | Complete except Spike B |
| 1 — Foundation | 4-6 | AuthProvider/StorageProvider, users/profile, CI, flavors | **In progress** |
| 2 — Exercise database | 7-9 | Ingest dataset, canonical model, browse/search | Not started |
| 3 — Walking skeleton | 10-15 | Templates, sessions, offline-first execution | Not started |
| Dogfood gate | 16-17 | Real training with the app | Not started |
| 4 — Programs | 18-21 | Program/week/day, enrollment, progression | Not started |
| 5 — InBody | 22-24 | Upload, Claude extraction, confirmation, BullMQ | Not started |
| 6 — Health Connect + analytics | 25-28 | HealthProvider, aggregation, dashboards | Not started |
| 7 — WHOOP | 29-30 | OAuth, webhooks, adapter | Not started |
| 8 — Privacy & beta prep | 31-34 | Legal, consent, Play closed testing clock | Not started |
| Limited Android beta | 35 | 12+ testers | Not started |
| 9 — Post-beta iteration | 36-39 | Fix what beta reveals | Not started |
| 10 — Leaderboards + subscriptions | 40-46 | CityResolver, ScoringStrategy, RevenueCat | Not started |
| 11 — iOS track (parallel with 10) | 40-46 | AppleHealthProvider, Codemagic, TestFlight → App Store | Not started |
| Dual-platform public launch | ~47 | Both stores | Not started |

## Decisions that shaped this sequencing

See the plan file's §1 (decisions D1-D9) and the ADRs in `docs/decisions/`
for the reasoning — most notably ADR-007, which is why Health Connect ships
before Apple Health and iOS runs as a parallel track rather than earlier.

## Working method

Every phase executes as vertical slices, never "build feature X" in one
shot. See `CLAUDE.md` for the rules this is checked against. At the start
of each phase, re-read this roadmap and the plan file's phase outline
before writing the phase's detailed task breakdown — later phases are
intentionally left as an outline to re-plan once earlier phases have taught
their lessons.

<!--
CI note: documentation-only changes skip the suite entirely (`paths-ignore` in
.github/workflows/ci.yml), on pull requests and on main alike. A merge like that produces
no run, which is intended rather than a trigger that failed. A change touching both a doc
and a source file still runs everything.
-->
