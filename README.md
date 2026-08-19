# FORJD

A unified fitness and health platform — strength training, wearable/health-platform data
(Apple Health, Health Connect, WHOOP), and InBody body-composition scanning in one place,
with AI-driven insights on top.

## Status

Pre-Phase 0. Repository skeleton only — no application code yet.

## Start here

- [`CLAUDE.md`](./CLAUDE.md) — architecture rules. Read before writing or generating any code.
- [`docs/product/vision.md`](./docs/product/vision.md) — what this product is and why.
- [`docs/product/roadmap.md`](./docs/product/roadmap.md) — phase-by-phase execution plan.
- [`docs/architecture/system.md`](./docs/architecture/system.md) — the four architectural
  principles everything else is checked against.
- [`docs/decisions/`](./docs/decisions/) — ADRs recording why, not just what.

## Stack

Flutter (mobile) · NestJS + TypeScript (API) · PostgreSQL via Supabase (data) ·
Redis + BullMQ (jobs, from Phase 5) · Drizzle ORM · Drift (local mobile DB) ·
pnpm workspaces + Docker Compose (local dev).

## Local setup

Prerequisites: Node.js LTS, pnpm (`corepack enable`), Flutter SDK, Docker Desktop,
Android Studio + SDK. See `docs/decisions/ADR-007-no-mac-ios-toolchain.md` for the iOS
toolchain, which does not require owning or renting a Mac.

```bash
docker compose up -d      # Postgres + Redis
pnpm install               # once apps/api has a package.json (Phase 1)
```
