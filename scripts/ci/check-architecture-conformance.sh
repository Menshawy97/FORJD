#!/usr/bin/env bash
# Makes CLAUDE.md rules 1-4 and 11-17 executable. See the "Enforced, not just stated"
# section of CLAUDE.md, ADR-003, and ADR-008.
#
# Exits non-zero on the first violated rule so CI fails loudly rather than warning quietly.

set -uo pipefail
cd "$(dirname "$0")/../.."

violations=0

report() {
  echo "CONFORMANCE VIOLATION: $1"
  echo "$2"
  violations=$((violations + 1))
}

# Guarded-directory existence assertions (H8 gap): every check below is wrapped in
# `if [ -d <dir> ]`, which is correct for a directory that legitimately doesn't exist yet in
# a young monorepo -- but silently no-ops, rather than failing, if one of these three roots is
# ever renamed or deleted after the fact. That turns "the flagship enforced rule doesn't fire"
# into "the flagship enforced rule doesn't even exist anymore, and CI stays green." Each of
# these three directories is expected to exist for the lifetime of this repo, so their absence
# is itself reported as a violation instead of being treated as configuration.
api_src_present=1
if [ ! -d apps/api/src ]; then
  report "guarded directory apps/api/src not found" \
    "This script scans apps/api/src for several architecture rules (Supabase/openai/WHOOP/USDA isolation). If it was intentionally renamed or removed, update this script and the CLAUDE.md rules/ADRs it enforces -- don't let the check silently stop running."
  api_src_present=0
fi

mobile_src_present=1
if [ ! -d apps/mobile/src ]; then
  report "guarded directory apps/mobile/src not found" \
    "This script scans apps/mobile/src for several architecture rules (openai/expo-secure-store/expo-sqlite/react-native-health-connect/WHOOP/rule-15 isolation). If it was intentionally renamed or removed, update this script and the CLAUDE.md rules/ADRs it enforces -- don't let the check silently stop running."
  mobile_src_present=0
fi

domain_src_present=1
if [ ! -d packages/domain/src ]; then
  report "guarded directory packages/domain/src not found" \
    "This script scans packages/domain/src for rules 1-2 (no UI or provider-SDK imports in domain code). If it was intentionally renamed or removed, update this script and the CLAUDE.md rules/ADRs it enforces -- don't let the check silently stop running."
  domain_src_present=0
fi

# Rule 11 / ADR-008: the Supabase SDK is reachable only from the two provider adapter dirs.
# Matches any package under the @supabase/ scope (not just supabase-js) -- @supabase/postgrest-js,
# @supabase/auth-js, @supabase/storage-js etc. are all still "the Supabase SDK" for rule 11's
# purposes, and a literal-package-name match let a sibling package through uncaught.
if [ "$api_src_present" = 1 ]; then
  hits=$(grep -rn --include='*.ts' '@supabase/' apps/api/src \
    | grep -v '^apps/api/src/auth/providers/' \
    | grep -v '^apps/api/src/storage/providers/' || true)
  if [ -n "$hits" ]; then
    report "a @supabase/* package imported outside apps/api/src/{auth,storage}/providers/" "$hits"
  fi
fi

# Rule 5 / CLAUDE.md: OpenAI must stay behind a single provider adapter file on mobile, not
# scattered across screens — mirrors the Supabase-SDK check above for the RN app.
# Scoped to apps/mobile/src (application source), not the whole app dir: app.config.ts,
# metro.config.js etc. at the app root are build/tooling config, not app code, and
# app.config.ts legitimately references plugin names as strings for Expo's config-plugin
# system (e.g. registering the expo-secure-store plugin below) — that isn't an import.
if [ "$mobile_src_present" = 1 ]; then
  hits=$(grep -rlnE --include='*.ts' --include='*.tsx' "['\"]openai(/[^'\"]*)?['\"]" apps/mobile/src \
    | grep -v '^apps/mobile/src/ai/providers/openai-provider.ts$' || true)
  if [ -n "$hits" ]; then
    report "openai imported outside apps/mobile/src/ai/providers/openai-provider.ts" "$hits"
  fi
fi

# Phase 5C / ADR-032: same rule as above, for the API side. NVIDIA's API is OpenAI-compatible,
# so the (development-only) NVIDIA vision extractor imports the `openai` SDK too -- and the
# OpenAI vision extractor obviously does. Both are pinned to the files allowed to know which
# vendor is behind VisionProvider, so a future vendor swap is a change to one pair of files,
# not a caller-visible one.
if [ "$api_src_present" = 1 ]; then
  hits=$(grep -rlnE --include='*.ts' "['\"]openai(/[^'\"]*)?['\"]" apps/api/src \
    | grep -v '^apps/api/src/ai/providers/nvidia-vision.provider.ts$' \
    | grep -v '^apps/api/src/ai/providers/nvidia-vision-client.ts$' \
    | grep -v '^apps/api/src/ai/providers/openai-vision.provider.ts$' \
    | grep -v '^apps/api/src/ai/providers/openai-vision-client.ts$' || true)
  if [ -n "$hits" ]; then
    report "openai imported outside apps/api/src/ai/providers/{nvidia,openai}-vision{.provider,-client}.ts" "$hits"
  fi
fi

# ADR-011: session tokens live in the platform keystore and nowhere else. Pinning the
# module to one file is what makes that checkable — a second caller could read or write a
# token without the reasoning in secureStorage.ts applying to it. Tests are exempt
# app-wide: `jest.mock('expo-secure-store')` at a component/screen test boundary verifies
# that component through the wrapper's real save/notify behaviour (see
# apps/mobile/src/app/__tests__/login.test.tsx's header comment for why that's preferred
# over mocking the wrapper itself), which is a different thing from production code
# reaching around the wrapper.
if [ -d apps/mobile/src ]; then
  hits=$(grep -rln --include='*.ts' --include='*.tsx' "['\"]expo-secure-store['\"]" apps/mobile/src \
    | grep -v '^apps/mobile/src/auth/secureStorage.ts$' \
    | grep -v '/__tests__/' || true)
  if [ -n "$hits" ]; then
    report "expo-secure-store imported outside apps/mobile/src/auth/secureStorage.ts" "$hits"
  fi
fi

# Phase H: the on-device exercise catalogue is the app's first real expo-sqlite consumer.
# Phase 3F (ADR-025) adds a second: the workout session event log and sync queue. Same
# reasoning in both cases -- screens never touch SQLite directly, they call one of these two
# files, so every write goes through the place that knows that table's own schema and sync
# contract (ExercisesService.getCatalogue's version gate; ADR-025's queue/retry contract).
if [ -d apps/mobile/src ]; then
  hits=$(grep -rln --include='*.ts' --include='*.tsx' "['\"]expo-sqlite['\"]" apps/mobile/src \
    | grep -v '^apps/mobile/src/store/exercise-catalogue.ts$' \
    | grep -v '^apps/mobile/src/store/workout-session.ts$' \
    | grep -v '/__tests__/' || true)
  if [ -n "$hits" ]; then
    report "expo-sqlite imported outside apps/mobile/src/store/{exercise-catalogue,workout-session}.ts" "$hits"
  fi
fi

# ADR-005 / Phase 2: the raw vendored dataset is readable only by the normalizer.
#
# The point is that ingest stays a reviewable, single-entry pipeline. Anything else reading
# free-exercise-db.json directly would be normalizing the source's vocabulary a second time,
# somewhere the golden-fixture tests and the committed snapshot do not cover -- which is how
# two slightly different ideas of what "cardio" maps to end up in one codebase. Downstream
# code reads normalized-exercises.json, or goes through the repository.
#
# Narrowed in Phase E from "anything under ingest/" to "the normalizer, plus the adapter spec
# that golden-tests against the real source rows". `exercises:load` lives in that same
# directory and must read the committed snapshot rather than the source: a loader that
# re-derived the mapping at deploy time would put the catalogue into the database in a shape
# no reviewer ever saw in a diff, which is the entire thing Phase D's snapshot exists to
# prevent -- and the old directory-wide exemption would not have caught it.
if [ -d apps/api/src ] || [ -d apps/mobile/src ]; then
  hits=$(grep -rn --include='*.ts' --include='*.tsx' 'free-exercise-db.json' \
    apps/api/src apps/mobile/src 2>/dev/null \
    | grep -v '^apps/api/src/exercises/ingest/normalize.ts:' \
    | grep -v '^apps/api/src/exercises/ingest/free-exercise-db.adapter.spec.ts:' || true)
  if [ -n "$hits" ]; then
    report "the raw free-exercise-db dataset is read outside the normalizer (apps/api/src/exercises/ingest/normalize.ts)" "$hits"
  fi
fi

# Rules 1-2: domain packages depend on neither UI nor provider SDKs.
#
# Quote-agnostic (['\"], not just ') -- packages/domain is mostly double-quoted, and the
# original single-quote-only pattern let `import { createClient } from "@supabase/supabase-js"`
# straight through (H8). Broadened past the original four modules to also catch openai,
# drizzle-orm, pg, @sentry/*, and axios -- each of those is a provider-SDK or infra dependency
# rule 1-2 already forbids in spirit, just not in this grep before now.
if [ -d packages/domain/src ]; then
  hits=$(grep -rn --include='*.ts' -E "from ['\"](@supabase/|@nestjs/|react|flutter|openai|drizzle-orm|pg|@sentry/|axios)" packages/domain/src || true)
  if [ -n "$hits" ]; then
    report "packages/domain imports UI or provider SDK code" "$hits"
  fi
fi

# Rule 15 / CLAUDE.md: health data must never reach an analytics or advertising SDK -- "not
# once, not 'just for debugging'". Claimed in this script's own header comment and in
# CLAUDE.md, but never actually enforced until now (H8's gap list). Scoped to
# apps/mobile/src, where health data lives client-side; crash reporting (Sentry) is a
# deliberately separate category rule 15 does not forbid and is not flagged here -- if a
# mobile Sentry integration is ever added, exempt its one adapter file the same way every
# other rule in this script exempts its allowed adapter, rather than loosening this pattern.
if [ -d apps/mobile/src ]; then
  hits=$(grep -rlnE --include='*.ts' --include='*.tsx' \
    "['\"](@react-native-firebase/(analytics|crashlytics|ads)|expo-analytics|@amplitude/|mixpanel|@segment/analytics|react-native-appsflyer|react-native-adjust|react-native-fbsdk|posthog-react-native|@fullstory/|@datadog/mobile-react-native|react-native-google-mobile-ads)" \
    apps/mobile/src || true)
  if [ -n "$hits" ]; then
    report "an analytics, advertising, attribution, or session-replay SDK is imported in apps/mobile/src (rule 15)" "$hits"
  fi
fi

# ADR-023 / Phase D: the raw vendored USDA CSVs are readable only by the normalizer, mirroring
# the free-exercise-db.json rule above exactly and for the same reason -- a second reader of
# food.csv/food_nutrient.csv/etc. would be a second, untested implementation of the category and
# kcal-precedence mapping the golden-fixture tests and the committed snapshot already cover.
# `fetch-usda.ts` is exempt because it *writes* these files (vendoring), not reads them for
# normalization; `load.ts` reads only the committed JSON snapshot, never the CSVs directly.
if [ -d apps/api/src ]; then
  hits=$(grep -rln --include='*.ts' -E '"(food|food_nutrient|food_portion|nutrient|measure_unit|food_category|wweia_food_category)\.csv"' \
    apps/api/src \
    | grep -v '^apps/api/src/nutrition/ingest/fetch-usda\.ts$' \
    | grep -v '^apps/api/src/nutrition/ingest/normalize\.ts$' || true)
  if [ -n "$hits" ]; then
    report "the raw vendored USDA CSVs are read outside the normalizer (apps/api/src/nutrition/ingest/normalize.ts)" "$hits"
  fi
fi

# Phase 6E / ADR-034 / CLAUDE.md rule 17: react-native-health-connect is an implementation
# detail behind HealthProvider, same reasoning as the expo-secure-store/expo-sqlite/openai
# rules above -- one place owns the vendor SDK, so a future provider swap (or the eventual
# WHOOP/AppleHealth adapters) never has to hunt for a second caller. No test exemption,
# matching the openai rules rather than expo-secure-store/expo-sqlite's -- health data is
# sensitive enough that even a test-only import should go through the same reviewed file.
# Added ahead of HealthConnectProvider (Phase 6F) existing, per the Phase 6 plan's own
# instruction to add this rule before the adapter that could violate it, not after.
if [ -d apps/mobile/src ]; then
  hits=$(grep -rln --include='*.ts' --include='*.tsx' "['\"]react-native-health-connect['\"]" apps/mobile/src \
    | grep -v '^apps/mobile/src/integrations/health/' || true)
  if [ -n "$hits" ]; then
    report "react-native-health-connect imported outside apps/mobile/src/integrations/health/" "$hits"
  fi
fi

# Phase 7D-7F / CLAUDE.md rule 4: WHOOP's own hostname is the tell for code that actually
# talks to WHOOP (as opposed to code that merely knows the provider name "whoop" as a
# HealthSource string, which is legitimate everywhere -- e.g. HEALTH_SOURCE_PRIORITY in
# packages/domain). Mirrors the react-native-health-connect directory-prefix rule above:
# one directory owns the vendor integration, so a future WHOOP API change or the eventual
# GarminProvider/OuraProvider adapters never have to hunt for a second caller.
if [ -d apps/api/src ]; then
  hits=$(grep -rln --include='*.ts' 'api\.prod\.whoop\.com' apps/api/src \
    | grep -v '^apps/api/src/integrations/whoop/' || true)
  if [ -n "$hits" ]; then
    report "WHOOP API hostname referenced outside apps/api/src/integrations/whoop/" "$hits"
  fi
fi

# Phase 7 decision 2 / CLAUDE.md rule 5: WHOOP's OAuth secret must never reach the mobile
# bundle -- the integration runs entirely server-side (docs/product/phase-7-plan.md,
# docs/architecture/integrations.md's WHOOP section). This is the mechanically enforceable
# version of that rule: no WHOOP hostname and no WHOOP client-secret-shaped identifier may
# appear in mobile production code. Test files are exempt (matching the
# expo-secure-store/expo-sqlite precedent above) because whoop-status/authorize response
# fixtures in tests legitimately embed a WHOOP URL as mocked *server* output, not a secret
# the mobile app itself holds.
if [ -d apps/mobile/src ]; then
  hits=$(grep -rln --include='*.ts' --include='*.tsx' -iE 'whoop\.com|WHOOP_CLIENT_SECRET|WHOOP_WEBHOOK_SECRET' apps/mobile/src \
    | grep -v '/__tests__/' || true)
  if [ -n "$hits" ]; then
    report "WHOOP hostname or secret-shaped identifier found in mobile production code" "$hits"
  fi
fi

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "$violations conformance rule(s) violated. Fix the import, or change the rule in CLAUDE.md"
  echo "and the ADR that justifies it — do not special-case around this check."
  exit 1
fi

echo "Architecture conformance: all rules pass."
