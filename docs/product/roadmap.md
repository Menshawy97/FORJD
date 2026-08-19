# Roadmap

Full phase-by-phase plan, decisions, and risk register:
`C:\Users\Mostafa Ashraf\.claude\plans\c-users-mostafa-ashraf-downloads-forjd-sleepy-hammock.md`

This file is a living summary kept in sync with that plan as phases
complete or get re-planned — the plan file is the detailed source, this is
the quick-reference for "what phase are we in and what's next."

## Current status (last updated 2026-08-19)

**We are inside Phase 0.** Read this section first when resuming — it says
exactly what's done, what's blocked on a manual step, and what to do next.
Don't re-derive this from scratch; verify it's still accurate and continue.

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
3. ⬜ **Hand-label Spike B ground truth.** This one is not automatable *in
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

**Finish Spike B first — it is the only Phase 0 spike that is started but
unfinished, and Phase 5 is designed around its answer.** Set the API key, run
`pnpm extract`, hand-label truth, run `pnpm score`, then fill in ADR-006's
Consequences table and flip its Status to Accepted (or, if confidence turns out
not to correlate with real errors, record that the confidence gate is decorative
and needs redesigning — that is a legitimate and valuable spike outcome, not a
failure).

After that, Phase 1 is unblocked: NestJS + Flutter shells and the
`AuthProvider`/`StorageProvider` adapters — see `docs/architecture/system.md`
and ADR-003. Local Postgres/Redis are already running, so nothing else gates it
except the physical Android device for on-device verification.

## Timeline (~38 weeks to Android beta, dual-platform public launch)

| Phase | Weeks | Focus | Status |
|---|---|---|---|
| 0 — Setup & decisions | 1-3 | Toolchain, accounts, repo skeleton, 3 spikes, business entity | **In progress** |
| 1 — Foundation | 4-6 | AuthProvider/StorageProvider, users/profile, CI, flavors | Not started |
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
