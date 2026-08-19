# Roadmap

Full phase-by-phase plan, decisions, and risk register:
`C:\Users\Mostafa Ashraf\.claude\plans\c-users-mostafa-ashraf-downloads-forjd-sleepy-hammock.md`

This file is a living summary kept in sync with that plan as phases
complete or get re-planned — the plan file is the detailed source, this is
the quick-reference for "what phase are we in and what's next."

## Current status (last updated 2026-08-19)

**We are inside Phase 1.** Phase 0 is complete except Spike B, which is open but
does not gate Phase 1 (see "Spike status" below). Read this section first when
resuming — it says exactly what's done, what's blocked on a manual step, and what
to do next. Don't re-derive this from scratch; verify it's still accurate and
continue.

### Phase 1 progress

Executing the 14-slice plan. **Nine of fourteen slices are done and verified —
1 through 10, except 11.** What remains is the mobile auth UI (11) and the three
deployment-shaped slices (12, 13, 14), which need the staging/prod Supabase
projects, a Railway account, and the physical Android device.

Half of the phase's definition of done is already mechanically true: exactly one
file imports the Supabase SDK for auth, one for storage, and nothing else —
verified by grep in CI rather than by discipline.

**Current test surface:** 12 API unit tests, 7 API e2e tests, 4 Flutter tests, all
passing. Lint, format, and the architecture-conformance check are green, and the
debug APK builds.

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
| 11 — Mobile auth UI | ⬜ Next | Unblocked — Slice 4's endpoints and DTOs exist. Login/register screens, Riverpod `AuthController`, Dio 401→refresh→retry interceptor, tokens in `flutter_secure_storage`. |
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
| Physical Android device | ⚠️ Not connected | Needs to be plugged in via USB with debugging enabled; `flutter devices` will pick it up. Still only Windows/Chrome/Edge are listed. |

### Manual steps only the user can do (genuine hard stops — need a UAC click, physical hardware, a credential, or human judgement)

Steps 1-4 of the original list (elevated setup script, reboot, Docker first-run,
git identity + initial commit) are **done**. What remains:

1. ⬜ **Plug in the physical Android device**, confirm with `flutter devices`.
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

**Build slice 11, the mobile auth and profile screens.** It is the last slice with no
external dependency: the API endpoints, the `@forjd/contracts` DTOs, the Flutter shell,
and the Drift store all exist. After it, everything left is deployment-shaped —
slices 12 → 13 → 14 — needing the staging and prod Supabase projects, a Railway
account, and the phone plugged in.

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
