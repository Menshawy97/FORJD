#!/usr/bin/env bash
# Fixture-driven test harness for check-architecture-conformance.sh (R12 / H8).
#
# The script under test is unaware it is being tested: each case copies the *real* script
# file (unmodified) plus a minimal skeleton of the directories it scans (apps/api/src,
# apps/mobile/src, packages/domain/src) into a scratch tree, then runs it from there. Because
# the script resolves its project root as `dirname "$0")/../..`, invoking the copied script by
# its scratch-tree path makes it scan the scratch tree instead of the real repo — no source
# file in this repo is ever touched, and no interface change to the script is required.
#
# Each case asserts an exit code: non-zero for a violation the script is supposed to catch,
# zero for the one "everything is fine" case. Run: `bash scripts/ci/check-architecture-conformance.test.sh`

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/scripts/ci/check-architecture-conformance.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: script under test not found at $SCRIPT_UNDER_TEST"
  exit 1
fi

SCRATCH_BASE="$(mktemp -d "${TMPDIR:-/tmp}/conformance-test.XXXXXX")"
cleanup() { rm -rf "$SCRATCH_BASE"; }
trap cleanup EXIT

total=0
failures=0

# ---------------------------------------------------------------------------------------
# Fixture-tree helpers
# ---------------------------------------------------------------------------------------

# new_case_dir NAME -> prints the absolute path of a fresh scratch tree for case NAME,
# pre-seeded with a copy of the real script and empty versions of the three scanned roots.
new_case_dir() {
  local name="$1"
  local dir="$SCRATCH_BASE/$name"
  mkdir -p "$dir/scripts/ci"
  cp "$SCRIPT_UNDER_TEST" "$dir/scripts/ci/check-architecture-conformance.sh"
  mkdir -p "$dir/apps/api/src" "$dir/apps/mobile/src" "$dir/packages/domain/src"
  echo "$dir"
}

# write FILE CONTENT -- creates parent dirs then writes CONTENT to FILE.
write() {
  local file="$1"
  local content="$2"
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$content" > "$file"
}

# ---------------------------------------------------------------------------------------
# run_case NAME EXPECTATION SETUP_FN
#   EXPECTATION: "pass" (script must exit 0) or "fail" (script must exit non-zero)
#   SETUP_FN: a function that receives the case dir and populates fixture files in it
# ---------------------------------------------------------------------------------------
run_case() {
  local name="$1"
  local expectation="$2"
  local setup_fn="$3"

  total=$((total + 1))
  local case_dir
  case_dir="$(new_case_dir "$name")"
  "$setup_fn" "$case_dir"

  local output
  local exit_code
  output="$(bash "$case_dir/scripts/ci/check-architecture-conformance.sh" 2>&1)"
  exit_code=$?

  local actual="pass"
  if [ "$exit_code" -ne 0 ]; then
    actual="fail"
  fi

  if [ "$actual" = "$expectation" ]; then
    echo "PASS  [$name] expected exit=$expectation, got exit=$exit_code"
  else
    echo "FAIL  [$name] expected exit=$expectation, got exit=$exit_code (script exit code $exit_code)"
    echo "      --- script output ---"
    echo "$output" | sed 's/^/      /'
    echo "      ----------------------"
    failures=$((failures + 1))
  fi
}

# =========================================================================================
# Case 1 -- H8's own repro: a double-quoted Supabase import inside packages/domain.
# Today's script only greps `from '...` (single quotes), so this passes CI green.
# =========================================================================================
setup_domain_double_quotes() {
  local dir="$1"
  write "$dir/packages/domain/src/leaky.ts" \
    'import { createClient } from "@supabase/supabase-js";'
}

# =========================================================================================
# Case 2 -- subpath imports evade exact-module matching.
#   - apps/mobile: `openai/resources` should be caught by the openai-provider rule, which
#     today matches only the bare string 'openai'.
#   - apps/mobile: `react-native-health-connect/lib/...` should be caught by the RNHC rule,
#     which today matches only the bare string 'react-native-health-connect'.
#   - apps/api: `@supabase/postgrest-js` is a different package under the same scope as
#     @supabase/supabase-js, and today's rule-11 check is a literal substring match on
#     '@supabase/supabase-js' only, so a sibling Supabase package is invisible to it.
# =========================================================================================
setup_subpath_imports() {
  local dir="$1"
  write "$dir/apps/mobile/src/vision.ts" \
    "import { something } from 'openai/resources';"
  write "$dir/apps/mobile/src/health-thing.tsx" \
    "import RNHC from 'react-native-health-connect/lib/index';"
  write "$dir/apps/api/src/pg-thing.ts" \
    'import { PostgrestClient } from "@supabase/postgrest-js";'
}

# =========================================================================================
# Case 3 -- modules missing from the domain-package allow-list (H8): openai, drizzle-orm,
# pg, @sentry/*, axios. All single-quoted, so this isolates the "missing module" gap from
# the quote-style gap already covered by case 1.
# =========================================================================================
setup_domain_missing_modules() {
  local dir="$1"
  write "$dir/packages/domain/src/uses-openai.ts" \
    "import OpenAI from 'openai';"
  write "$dir/packages/domain/src/uses-drizzle.ts" \
    "import { pgTable } from 'drizzle-orm/pg-core';"
  write "$dir/packages/domain/src/uses-pg.ts" \
    "import { Pool } from 'pg';"
  write "$dir/packages/domain/src/uses-sentry.ts" \
    "import * as Sentry from '@sentry/node';"
  write "$dir/packages/domain/src/uses-axios.ts" \
    "import axios from 'axios';"
}

# =========================================================================================
# Case 4 -- rule 15 (analytics/advertising SDKs must never touch health data) is claimed in
# the script's header comment and CLAUDE.md, but nothing in the script actually greps for
# one. An analytics SDK import in apps/mobile should fail; today it silently passes.
# =========================================================================================
setup_mobile_analytics_sdk() {
  local dir="$1"
  write "$dir/apps/mobile/src/track.ts" \
    "import analytics from '@react-native-firebase/analytics';"
}

# =========================================================================================
# Case 5 -- a guarded directory that no longer exists passes vacuously. Every check in the
# script is wrapped in `if [ -d <dir> ]; then ... fi`, so deleting/renaming packages/domain
# entirely makes the whole rules-1-2 check a silent no-op: 0 violations, exit 0, green CI --
# even though the intent (no UI/provider-SDK imports in domain code) can no longer be
# verified at all. Note this case's fixture tree deliberately does NOT create
# packages/domain/src (new_case_dir creates it; we remove it here).
# =========================================================================================
setup_missing_guarded_directory() {
  local dir="$1"
  rm -rf "$dir/packages/domain"
}

# =========================================================================================
# Case 6 -- the one passing case: a clean tree, plus a representative sample of legitimate
# imports living in exactly the allow-listed adapter files/directories for every rule the
# script enforces. This is what keeps the harness honest -- if a GREEN-phase fix over-widens
# a pattern and starts flagging these legitimate, already-reviewed imports, this case flips
# from pass to fail.
# =========================================================================================
setup_everything_clean() {
  local dir="$1"

  write "$dir/apps/api/src/auth/providers/supabase-auth.provider.ts" \
    "import { createClient } from '@supabase/supabase-js';"
  write "$dir/apps/api/src/storage/providers/supabase-storage.provider.ts" \
    "import { createClient } from '@supabase/supabase-js';"

  write "$dir/apps/mobile/src/ai/providers/openai-provider.ts" \
    "import OpenAI from 'openai';"
  write "$dir/apps/api/src/ai/providers/nvidia-vision.provider.ts" \
    "import OpenAI from 'openai';"
  write "$dir/apps/api/src/ai/providers/nvidia-vision-client.ts" \
    "import OpenAI from 'openai';"
  write "$dir/apps/api/src/ai/providers/openai-vision.provider.ts" \
    "import OpenAI from 'openai';"
  write "$dir/apps/api/src/ai/providers/openai-vision-client.ts" \
    "import OpenAI from 'openai';"

  write "$dir/apps/mobile/src/auth/secureStorage.ts" \
    "import * as SecureStore from 'expo-secure-store';"

  write "$dir/apps/mobile/src/store/exercise-catalogue.ts" \
    "import * as SQLite from 'expo-sqlite';"
  write "$dir/apps/mobile/src/store/workout-session.ts" \
    "import * as SQLite from 'expo-sqlite';"

  write "$dir/apps/api/src/exercises/ingest/normalize.ts" \
    "const SOURCE = 'free-exercise-db.json';"
  write "$dir/apps/api/src/exercises/ingest/free-exercise-db.adapter.spec.ts" \
    "const SOURCE = 'free-exercise-db.json';"

  write "$dir/apps/api/src/nutrition/ingest/fetch-usda.ts" \
    "const FILES = ['food.csv', 'food_nutrient.csv'];"
  write "$dir/apps/api/src/nutrition/ingest/normalize.ts" \
    "const FILES = ['food.csv', 'food_nutrient.csv'];"

  write "$dir/apps/mobile/src/integrations/health/health-connect.provider.ts" \
    "import HealthConnect from 'react-native-health-connect';"

  write "$dir/apps/api/src/integrations/whoop/whoop-client.ts" \
    "const WHOOP_BASE_URL = 'https://api.prod.whoop.com';"

  write "$dir/packages/domain/src/index.ts" \
    "import { z } from 'zod';"
}

# =========================================================================================
# Run all cases
# =========================================================================================
echo "== check-architecture-conformance.test.sh =="
echo "Script under test: $SCRIPT_UNDER_TEST"
echo ""

run_case "domain-double-quotes"        fail setup_domain_double_quotes
run_case "subpath-imports"             fail setup_subpath_imports
run_case "domain-missing-modules"      fail setup_domain_missing_modules
run_case "mobile-analytics-sdk"        fail setup_mobile_analytics_sdk
run_case "missing-guarded-directory"   fail setup_missing_guarded_directory
run_case "everything-clean"            pass setup_everything_clean

echo ""
echo "$((total - failures))/$total cases behaved as expected."

if [ "$failures" -gt 0 ]; then
  echo "$failures case(s) FAILED."
  exit 1
fi

echo "All cases passed."
