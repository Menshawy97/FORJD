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
- **22 files staged, zero commits made.** `git init` was run but the local
  git identity (`user.name` / `user.email`) was never set on this machine —
  the user opted to set it themselves rather than have it set for them.
  **Before anything else, check `git log` — if it's still empty, run:**
  ```bash
  git config user.email "you@example.com"
  git config user.name "Your Name"
  git commit -m "Initialize FORJD repo: architecture rules, ADRs, and planning docs"
  ```
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
| Docker Desktop | ⚠️ Installed, not usable yet | App installed via winget, but WSL2 (its dependency) is not enabled — enabling it requires admin elevation this session doesn't have. **Blocked on a manual step, see below.** |
| Physical Android device | ⚠️ Not connected | Needs to be plugged in via USB with debugging enabled; `flutter devices` will pick it up. |

### Manual steps only the user can do (all genuine hard stops — need a UAC click, a reboot, or physical hardware)

1. **Run `scripts/setup-windows-dev.ps1` from an elevated PowerShell** (right-click →
   Run as Administrator). It enables Developer Mode, NTFS long paths, WSL2 +
   Virtual Machine Platform (needed for Docker Desktop), and Defender
   exclusions for the repo and SDK folders.
2. **Reboot** — required for WSL2 and Developer Mode to take effect.
3. **Launch Docker Desktop once manually** after rebooting, to accept its
   license and finish first-run setup.
4. **Set git identity and make the initial commit** (see Repo section above).
5. **Plug in the physical Android device**, confirm with `flutter devices`.

None of the above blocks Phase 1 application-code work except Docker
(needed for local Postgres/Redis) and the initial commit (should happen
before more code piles up uncommitted).

### Phase 0 items not yet started (not toolchain — calendar/business, only the user can act)

- Business entity registration, D-U-N-S number
- Google Play Console + Apple Developer *organization* accounts
- Legal engagement for privacy policy / ToS
- Spike A (exercise dataset evaluation), Spike B (InBody photos + Claude
  vision test), Spike C (iOS pipeline via Codemagic — gated on Apple org
  approval, so naturally later than A/B)

### Next action once resumed

If the manual steps above are done: proceed to Phase 1 (NestJS + Flutter
shells, `AuthProvider`/`StorageProvider` adapters — see `docs/architecture/system.md`
and ADR-003). If they aren't done yet, either wait on the user or continue
with anything in Phase 0 that doesn't depend on them (e.g. Spike A doesn't
need Docker or a reboot).

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
