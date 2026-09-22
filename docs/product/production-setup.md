# Setting up production

Status: **provisioned, migrated and deployed** (2026-09-22): production is on migration `0022` (the run
tables), `/api/v1/health` answers `database: up`, and the exercise/nutrition catalogues and programs are
seeded. The steps below are kept as the record of how it was done. Production is the second of the two
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

## Known gap: exercise-media mirroring fails on production

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

## What is wrong today

- The Supabase project `forjd-prod` (ref `lzhwyvrtkmgtjruvjins`, eu-west-1) exists but is **paused**
  (`INACTIVE`). Free projects pause after a week of inactivity, and can only be restored for a limited
  window after that.
- The secret `forjd-production-database-url` does not resolve to a host (`getaddrinfo EAI_AGAIN base`),
  so both `deploy-api.yml -f target=production` (fails at `drizzle-kit migrate`) and the production job of
  `leaderboard-snapshot.yml` fail.

## Steps, in order

1. **Restore the project.** Supabase dashboard, `forjd-prod`, Restore project. Wait until it reads Healthy.
   If the dashboard says it can no longer be restored, create a new free project and tell the assistant its
   ref, since the docs and secrets name this one.
2. **Get the session-pooler connection string.** Project Settings, Database, Connection string, "Session
   pooler" (not the direct one: GitHub-hosted runners have no IPv6). Reset the database password there if it
   is not known. URL-encode any special characters in the password.
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

## Also before public launch (not needed for a first deploy)

- Shorten the Supabase access-token lifetime to 900 seconds (`docs/architecture/security.md`).
- Set `API_BASE_URL` for the production profile in `apps/mobile/eas.json` (it is still a placeholder).
- A Google Cloud billing-linked Maps key for the run screen (`docs/product/live-run-plan.md`).
