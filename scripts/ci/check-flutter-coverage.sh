#!/usr/bin/env bash
# Fails the build when Flutter line coverage drops below the floor.
#
# The repo has claimed an 80% bar since Phase 1 and enforced nothing: `flutter test` ran
# without --coverage, so no number existed to compare against. This is the smaller half of
# fixing that (the API half lives in apps/api/package.json's coverageThreshold).
#
# The floor is set at what the suite measures today, not at the aspiration. A threshold
# picked for how it sounds fails on the day it lands and gets deleted the day after; one
# set at the measured value can only be raised deliberately.

set -euo pipefail
cd "$(dirname "$0")/../.."

FLOOR="${FLUTTER_COVERAGE_FLOOR:-75}"
LCOV="apps/mobile/coverage/lcov.info"

if [ ! -f "$LCOV" ]; then
  echo "No $LCOV. Run: cd apps/mobile && flutter test --coverage"
  exit 1
fi

# LH is lines hit, LF is lines found, one pair per source file.
read -r hit found <<EOF2
$(awk -F: '/^LH:/ { h += $2 } /^LF:/ { f += $2 } END { print h, f }' "$LCOV")
EOF2

if [ -z "${found:-}" ] || [ "$found" -eq 0 ]; then
  # A truncated or empty lcov file would otherwise divide by zero and read as a pass.
  echo "$LCOV reports no lines at all. Treating that as a failure, not as 100%."
  exit 1
fi

percent=$(awk -v h="$hit" -v f="$found" 'BEGIN { printf "%.2f", 100 * h / f }')

echo "Flutter line coverage: $hit/$found = $percent% (floor $FLOOR%)"

if awk -v p="$percent" -v floor="$FLOOR" 'BEGIN { exit !(p < floor) }'; then
  echo ""
  echo "Coverage is below the floor. Add tests, or lower the floor deliberately and say"
  echo "why in the commit message — do not lower it silently to make a build pass."
  exit 1
fi
