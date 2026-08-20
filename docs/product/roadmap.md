# Roadmap

Full phase-by-phase plan, decisions, and risk register:
`C:\Users\Mostafa Ashraf\.claude\plans\c-users-mostafa-ashraf-downloads-forjd-sleepy-hammock.md`

This file is a living summary kept in sync with that plan as phases
complete or get re-planned — the plan file is the detailed source, this is
the quick-reference for "what phase are we in and what's next."

## Current status (last updated 2026-08-20)

**We are inside Phase 1.** Phase 0 is complete except Spike B, which is open but
does not gate Phase 1 (see "Spike status" below). Read this section first when
resuming — it says exactly what's done, what's blocked on a manual step, and what
to do next. Don't re-derive this from scratch; verify it's still accurate and
continue.

### Phase 1 progress

Executing the 14-slice plan. **Slices 1-11 are done and merged; `main` is green.** The
app has been walked end to end on an Android emulator against the live API — see "The
emulator walk" below. What remains is the three deployment-shaped slices (12, 13, 14),
which need the staging/prod Supabase projects, a Railway account, and the physical
Android device.

Half of the phase's definition of done is already mechanically true: exactly one
file imports the Supabase SDK for auth, one for storage, and nothing else —
verified by grep in CI rather than by discipline.

**Current test surface:** 23 API unit tests, 12 API e2e tests, 60 Flutter tests, all
passing. Lint, format, `flutter analyze`, and the architecture-conformance check are
green, and the debug APK builds with the native secure-storage plugin.

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
- A real coverage gate. The repo *states* 80% but enforces nothing — `collectCoverageFrom`
  has no `coverageThreshold`, and `flutter test` runs without `--coverage`.
- Generating the Dart DTOs from the Zod contracts. They are hand-written mirrors today and
  can drift silently.
- Optional CI hardening: a conformance grep pinning `flutter_secure_storage` to
  `secure_token_store.dart`, in the same spirit as the existing Supabase grep.
- Golden tests. Deliberately skipped: `flutter test` substitutes Ahem for bundled fonts, so
  goldens need an explicit `FontLoader` — a separate decision (ADR-010).
- A `calendar` icon. The set has 24 and none of them is one, so the birthday field uses
  `clock`. Adding it means adding a path in the design's stroke style.
- The launcher icon is still the default Flutter icon.
- `AppColors.errorText` (`#E05A3C`) sits close to the accent, so an inline error reads a
  little like a link. A palette decision, deliberately not taken unilaterally.
- A test for `SupabaseAuthProvider`'s weak-password passthrough. It has been exercised by
  hand on a device but has no automated cover, because the class builds its client in the
  constructor and offers no seam to stub (ADR-011).

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
| 11 — Mobile auth UI | ✅ Done | Merged (PRs #2, #3). Design tokens + Archivo, the widget library, the network layer with 401→refresh→replay, auth screens, the 5-tab shell, profile/edit-profile, and ADR-010/011. Walked on an emulator against the live API; four findings fixed. 60 Flutter tests; debug APK builds. |
| 12 — Build flavors | ⬜ Blocked | Needs all three Supabase projects. |
| 13 — Staging deploy | ⬜ Blocked | Host decided: **Railway** (ADR-009). Needs the staging Supabase project and a Railway account. |
| 14 — Device DoD walk | ⬜ Not started | Needs 12/13 plus the physical Android device. |

Phase 1's definition of done is unchanged: register → login → refresh → logout →
view/edit profile against the deployed staging API from the physical device, with
no file outside `apps/api/src/auth/providers/` importing the Supabase SDK.

### Deferred deliberately from the Phase 1 review

Two review findings were judged as tradeoffs rather than defects, and are tracked here
rather than silently dropped.

**Token verification is uncached.** `JwtAuthGuard` calls Supabase on every authenticated
request, which adds latency and makes Supabase Auth availability a dependency of every
call. The obvious fix — caching verification results — trades away revocation latency: a
logged-out or compromised token stays valid until the cache entry expires. That is a real
security cost, not a free win, so it should be a deliberate decision with a chosen TTL and
not a reflex optimisation. Revisit when measured latency justifies it.

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
- No application code yet (`apps/api`, `apps/mobile` are empty placeholder
  directories, correctly untracked by git since they're empty).

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
   ⬜ **Still needed: `forjd-staging` and `forjd-prod`**, for slice 12 (build flavors),
   so a debug build physically cannot reach production data.
4. ⬜ **Create the Railway account and project.** The host is decided (ADR-009);
   what remains is the account itself, which needs a card and is therefore yours
   to do. Only slice 13 depends on it, so there is no rush — but the Phase 1
   definition of done requires a *deployed* staging API, so it does gate the phase
   closing. Verify current pricing while you are there; ADR-009 records that it
   was not checked.
5. ⬜ **Hand-label Spike B ground truth.** This one is not automatable *in
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

**Slice 11 is merged, walked on an emulator, and its findings fixed. Start slice 12.**
Everything left in Phase 1 is deployment-shaped and gated on things only the user can
provide — the staging and prod Supabase projects, a Railway account, and the physical
Android device.

Nothing is half-finished. The next session can go straight to slice 12 once the Supabase
projects exist; if they do not yet, there is no unblocked Phase 1 work left, and the
useful thing to do instead is re-plan Phase 2 (see the bottom of this section).

### Next, in order

1. **Slice 12 — build flavors.** Needs `forjd-staging` and `forjd-prod` to exist first. The
   point is that a debug build physically cannot reach production data. `API_BASE_URL` is
   already a compile-time `String.fromEnvironment`, so the mobile side is mostly wiring
   flavors to defines rather than new code.
2. **Slice 13 — deploy staging to Railway** (ADR-009). Needs the Railway account. Note the
   IPv6 finding below: use the **session pooler** connection string when the hosted database
   is first migrated, not the direct one.
3. **Slice 14 — the definition-of-done walk on the physical device**, against deployed
   staging. This is what actually closes Phase 1.

Before starting slice 12, re-read this file and the plan's Phase 1 outline, as the working
method below requires. Phase 2 (exercise database) should be re-planned rather than executed
from the outline — later phases were deliberately left thin so earlier ones could teach their
lessons, and slice 11 taught several worth carrying forward: mirror provider-side constraints
in the contract, walk a flow live before believing it, and prefer a test that has been shown
to fail against the unfixed code.

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
