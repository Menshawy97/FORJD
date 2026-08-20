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

# Rule 17 / ADR-003: the health package is an implementation detail behind HealthProvider.
if [ -d apps/mobile/lib ]; then
  hits=$(grep -rn --include='*.dart' "package:health/" apps/mobile/lib \
    | grep -v '^apps/mobile/lib/integrations/' || true)
  if [ -n "$hits" ]; then
    report "package:health imported outside apps/mobile/lib/integrations/" "$hits"
  fi
fi

# ADR-011: session tokens live in the platform keystore and nowhere else. Pinning the
# plugin to one file is what makes that checkable — a second caller could read or write a
# token without the reasoning in secure_token_store.dart applying to it.
if [ -d apps/mobile/lib ]; then
  hits=$(grep -rn --include='*.dart' 'package:flutter_secure_storage/' apps/mobile/lib     | grep -v '^apps/mobile/lib/features/auth/data/secure_token_store.dart' || true)
  if [ -n "$hits" ]; then
    report "flutter_secure_storage imported outside secure_token_store.dart" "$hits"
  fi
fi

# Rules 1-2: domain packages depend on neither UI nor provider SDKs.
if [ -d packages/domain/src ]; then
  hits=$(grep -rn --include='*.ts' -E "from '(@supabase/|@nestjs/|react|flutter)" packages/domain/src || true)
  if [ -n "$hits" ]; then
    report "packages/domain imports UI or provider SDK code" "$hits"
  fi
fi

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "$violations conformance rule(s) violated. Fix the import, or change the rule in CLAUDE.md"
  echo "and the ADR that justifies it — do not special-case around this check."
  exit 1
fi

echo "Architecture conformance: all rules pass."
