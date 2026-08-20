#!/usr/bin/env bash
# Fails the build when the release APK grows past its budget.
#
# CI built a *debug* APK until now, which is several times larger than a release build and
# says nothing about what ships. There was therefore no size number anywhere in the repo,
# and no way to notice a dependency quietly adding megabytes.
#
# Note what this does and does not measure. Flutter does not enable R8 by default, so this
# is an unminified release APK: it reflects Dart AOT output and asset tree-shaking, not
# Java/Kotlin shrinking. Enabling R8 is a separate change that needs validating on a device
# before it can be trusted, and the budget will need re-baselining when it lands.

set -euo pipefail
cd "$(dirname "$0")/../.."

APK="${APK_PATH:-apps/mobile/build/app/outputs/flutter-apk/app-release.apk}"
# 5% above the 20,861,242 bytes measured on 2026-08 for a single-ABI arm64 build. Tight
# enough that a new dependency shows up, loose enough that a toolchain patch does not.
BUDGET="${APK_SIZE_BUDGET:-21904305}"

if [ ! -f "$APK" ]; then
  echo "No $APK. Run: cd apps/mobile && flutter build apk --release --target-platform android-arm64"
  exit 1
fi

size=$(wc -c < "$APK" | tr -d '[:space:]')
human() { awk -v b="$1" 'BEGIN { printf "%.2f MB", b / 1048576 }'; }

echo "Release APK: $size bytes ($(human "$size")), budget $BUDGET bytes ($(human "$BUDGET"))"

if [ "$size" -gt "$BUDGET" ]; then
  echo ""
  echo "The APK is over budget. Either the growth is justified — in which case raise"
  echo "APK_SIZE_BUDGET in this script and say what grew and why — or it is not."
  exit 1
fi
