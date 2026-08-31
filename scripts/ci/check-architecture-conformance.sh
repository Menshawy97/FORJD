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

# Rule 11 / ADR-008: the Supabase SDK is reachable only from the two provider adapter dirs.
if [ -d apps/api/src ]; then
  hits=$(grep -rn --include='*.ts' '@supabase/supabase-js' apps/api/src \
    | grep -v '^apps/api/src/auth/providers/' \
    | grep -v '^apps/api/src/storage/providers/' || true)
  if [ -n "$hits" ]; then
    report "@supabase/supabase-js imported outside apps/api/src/{auth,storage}/providers/" "$hits"
  fi
fi

# Rule 5 / CLAUDE.md: OpenAI must stay behind a single provider adapter file on mobile, not
# scattered across screens — mirrors the Supabase-SDK check above for the RN app.
# Scoped to apps/mobile/src (application source), not the whole app dir: app.config.ts,
# metro.config.js etc. at the app root are build/tooling config, not app code, and
# app.config.ts legitimately references plugin names as strings for Expo's config-plugin
# system (e.g. registering the expo-secure-store plugin below) — that isn't an import.
if [ -d apps/mobile/src ]; then
  hits=$(grep -rln --include='*.ts' --include='*.tsx' "['\"]openai['\"]" apps/mobile/src \
    | grep -v '^apps/mobile/src/ai/providers/openai-provider.ts$' || true)
  if [ -n "$hits" ]; then
    report "openai imported outside apps/mobile/src/ai/providers/openai-provider.ts" "$hits"
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
# Same reasoning as the expo-secure-store pin just above -- screens never touch SQLite
# directly, they call exercise-catalogue.ts, so that every write goes through the one place
# that knows the schema and the version-gating contract with ExercisesService.getCatalogue.
if [ -d apps/mobile/src ]; then
  hits=$(grep -rln --include='*.ts' --include='*.tsx' "['\"]expo-sqlite['\"]" apps/mobile/src \
    | grep -v '^apps/mobile/src/store/exercise-catalogue.ts$' \
    | grep -v '/__tests__/' || true)
  if [ -n "$hits" ]; then
    report "expo-sqlite imported outside apps/mobile/src/store/exercise-catalogue.ts" "$hits"
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
if [ -d packages/domain/src ]; then
  hits=$(grep -rn --include='*.ts' -E "from '(@supabase/|@nestjs/|react|flutter)" packages/domain/src || true)
  if [ -n "$hits" ]; then
    report "packages/domain imports UI or provider SDK code" "$hits"
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

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "$violations conformance rule(s) violated. Fix the import, or change the rule in CLAUDE.md"
  echo "and the ADR that justifies it — do not special-case around this check."
  exit 1
fi

echo "Architecture conformance: all rules pass."
