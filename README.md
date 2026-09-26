# FORJD

A unified fitness and health platform — strength training, running and HYROX, wearable and
health-platform data (Health Connect, WHOOP; Apple Health planned), nutrition, and InBody
body-composition scanning in one place, with insights on top.

## Status

In active development: the mobile app, API and marketing site are built and deployed to
staging and production. Phase-by-phase progress, including what is done, in flight and owed,
lives in [`docs/product/roadmap.md`](./docs/product/roadmap.md), the single source of truth
for status. This README deliberately does not repeat it.

## Start here

- [`CLAUDE.md`](./CLAUDE.md) — architecture rules. Read before writing or generating any code.
- [`docs/product/vision.md`](./docs/product/vision.md) — what this product is and why.
- [`docs/product/roadmap.md`](./docs/product/roadmap.md) — phase-by-phase execution plan and status.
- [`docs/architecture/system.md`](./docs/architecture/system.md) — the four architectural
  principles everything else is checked against.
- [`docs/decisions/`](./docs/decisions/) — ADRs recording why, not just what.

## Stack

| Part | What | Where |
|---|---|---|
| Mobile app | Expo SDK 57 / React Native, Expo Router, NativeWind, `expo-sqlite` for offline workouts (ADR-013, ADR-027) | `apps/mobile` |
| API | NestJS + TypeScript, Drizzle ORM, versioned under `/api/v1/` | `apps/api` |
| Data and auth | PostgreSQL, Supabase Auth and Storage, reached only through the provider adapters (rule 11) | Supabase |
| Website | Astro, static, on Cloudflare Pages (ADR-051) | `apps/web` |
| Shared | Domain model and calculations; API contracts (Zod) | `packages/domain`, `packages/contracts` |
| Hosting | Google Cloud Run, `europe-west1` (ADR-055), deployed by GitHub Actions | `.github/workflows` |

pnpm workspaces throughout. Analytics are computed on read (ADR-029); there is no job queue.

## Local setup

Prerequisites: Node.js 22+, pnpm (`corepack enable`), Docker Desktop, and Android Studio with
the Android SDK for device builds. iOS ships without a Mac; see
`docs/decisions/ADR-007-no-mac-ios-toolchain.md`.

```bash
docker compose up -d                        # local Postgres (and an unused Redis)
pnpm install
cp apps/api/.env.example apps/api/.env      # then fill in the values
pnpm --filter @forjd/domain --filter @forjd/contracts build
pnpm --filter @forjd/api db:migrate
pnpm --filter @forjd/api start:dev          # the API
pnpm --filter @forjd/mobile start           # the app (dev client; see apps/mobile/AGENTS.md)
pnpm --filter @forjd/web dev                # the website
```

`pnpm test` runs every package's tests; `pnpm conformance` runs the architecture checks CI runs.
