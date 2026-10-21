# Setting up production

Status: **provisioned, migrated and deployed.** Last production deploy 2026-10-08 (`5f26c4d`, migration
`0037`, the newest on `main`). Checked 2026-10-15: `/api/v1/health` answers `database: up`. The API code
on `main` has moved on since then (#390 database connection limits, #401 the Home bell's notifications
list), so the next production deploy (owner) brings those over; no new migration is waiting. The steps below are kept as the record of how it was done. Production is the second of the two
free Supabase projects (the free tier allows two; `forjd-dev` serves staging). Everything below is the
user's to do: each step creates or restores infrastructure or handles a credential, which the assistant is
not permitted to do here (the roadmap's Phase 6 close says the same about Secret Manager writes).

## Migration log

- **2026-09-21:** first deploy, migrations up to `0021`.
- **2026-09-22:** dispatched `deploy-api.yml -f target=production` (run
  [35700835056](https://github.com/Menshawy97/FORJD/actions/runs/35700835056)) to bring the live-run tables
  (`0022`, `workout_run_summaries` / `workout_run_splits`) onto production, so R1–R8's server side matches
  what mobile already ships. `db:migrate` reported "migrations applied successfully", the catalogue/nutrition
  loaders and program seed ran, and `/api/v1/health` confirmed `database: up` immediately after. Future
  sessions: production tracks whatever migration `main` is on; check `apps/api/drizzle/meta/_journal.json`'s
  latest entry against the deploy's `db:migrate` output before assuming it's current.
- **2026-10-08:** `deploy-api.yml -f target=production` (run
  [37860930248](https://github.com/Menshawy97/FORJD/actions/runs/37860930248), `5f26c4d`) brought production
  to `0037`, deny-all row-level security on every table (ADR-066, #386).

## Known gap: exercise-media mirroring fails on production

*Last observed on the 2026-09-22 deploy; not re-checked since the 2026-10-08 one (row-level security
changed in between).*

The same run's **"Mirror exercise media"** step failed (job still reports success — that step's failure is
not fatal to the deploy):

```
InternalServerErrorException: Bucket setup failed: new row violates row-level security policy
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @forjd/api@0.0.0 exercises:mirror-media
```

`SupabaseStorageProvider.ensureBucket` (`apps/api/src/storage/providers/supabase-storage.provider.ts`)
calls `client.storage.createBucket('exercise-media', ...)` with the service-role key from
`forjd-production-supabase-service-role-key`. A service-role key should bypass Storage RLS entirely, so this
points at one of: the secret actually holds the `anon` key rather than `service_role` (check Project
Settings → API on `forjd-prod`, ref `lzhwyvrtkmgtjruvjins`), or a custom RLS policy on `storage.buckets` in
the production project that staging's `forjd-dev` doesn't have. Compare the two projects' Storage policies,
or just re-check which key was pasted into the secret in step 3 below.

**Not blocking today**: exercise data and workouts function without mirrored media; only the exercise
images/animations are missing on production until this is fixed. Loader idempotency means a re-run of this
step later will fill in only what's still missing, once the RLS or key issue is resolved.

## Past problem, now fixed

An earlier note here said the `forjd-prod` Supabase project was **paused** and that the secret
`forjd-production-database-url` did not resolve (`getaddrinfo EAI_AGAIN base`), so production deploys
failed at `drizzle-kit migrate`. That is no longer true: the 2026-10-08 production deploy migrated
successfully, and on 2026-10-15 `/api/v1/health` answered `database: up`. If it happens again (free
projects pause after a week without use), the steps below are how to recover.

## Steps, in order

1. **Restore the project.** Supabase dashboard, `forjd-prod`, Restore project. Wait until it reads Healthy.
   If the dashboard says it can no longer be restored, create a new free project and tell the assistant its
   ref, since the docs and secrets name this one.
2. **Get the session-pooler connection string.** Project Settings, Database, Connection string, "Session
   pooler" (not the direct one: GitHub-hosted runners have no IPv6). Reset the database password there if it
   is not known. URL-encode any special characters in the password.
   In session mode every open connection holds a database connection, so the API keeps its share small:
   5 per instance (`apps/api/src/database/pool-options.ts`) and at most 3 instances (`deploy-api.yml`).
   Raising either is a deliberate change; `pool-options.spec.ts` fails if the total passes 15.
3. **Create the four secrets** in Google Cloud project `forjd-506508`, in Secret Manager:
   - `forjd-production-database-url`: the pooler string from step 2
   - `forjd-production-supabase-url`: `https://lzhwyvrtkmgtjruvjins.supabase.co`
   - `forjd-production-supabase-service-role-key`: from Project Settings, API (the `service_role` key)
   - `forjd-production-openai-api-key`: the OpenAI key (ADR-033 makes OpenAI the production vendor)

   The staging secrets were made with `printf '%s' "<value>" | gcloud secrets create <name> --data-file=-
   --project=forjd-506508`.
4. **Grant the runtime service account read access** to each of the four:
   `gcloud secrets add-iam-policy-binding <name> --member="serviceAccount:772363715082-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project=forjd-506508`
5. **Check the GitHub `production` environment** has the same variables as `staging`:
   `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`, `GCP_REGION`.
6. **Then tell the assistant.** It dispatches `deploy-api.yml` for production, watches the migration step
   apply all migrations to the empty database, confirms `/api/v1/health` answers `database: up`, then runs
   the leaderboard snapshot for production twice to confirm a re-run replaces rather than duplicates.

## Shipping an app change: store build or over-the-air update (ADR-070)

A change to JavaScript only (screens, copy, styling, logic) can go out as an over-the-air update. Anything
native (a library with native code, a config plugin, a permission, the icon, an SDK upgrade) needs a store
build. You do not have to decide which: the script works it out.

1. Commit the change.
2. `pnpm --filter @forjd/mobile update:staging -m "what changed"`. It prints each platform's runtime
   version and whether a staging build can take it. If none can, it stops: make a store build instead.
3. On the staging phone, close the app fully and open it twice: the first launch downloads the update,
   the second runs it.
4. `pnpm --filter @forjd/mobile update:production -m "what changed"` from the same commit (it refuses
   uncommitted changes).
5. If it goes wrong: `pnpm --filter @forjd/mobile exec eas update:rollback --channel production`.

Never run a bare `eas update`: it does not read the API address from eas.json, so it would ship the
localhost default to every phone on the channel. The first builds with `expo-updates` (staging and
production, after 2026-10-21) are the first that can take updates; phones on older builds never get one.

## Also before public launch (not needed for a first deploy)

- Shorten the Supabase access-token lifetime to 900 seconds (`docs/architecture/security.md`).
- Set `API_BASE_URL` for the production profile in `apps/mobile/eas.json` (it is still a placeholder).
- A Google Cloud billing-linked Maps key for the run screen (`docs/product/live-run-plan.md`).
