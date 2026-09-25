# Lane 1 — Architecture conformance (2026-09-25, at b1f006a)

No blocker or high beyond the known Health Connect cross-origin calorie gap (confirmed still present at
`apps/mobile/src/features/run/run-health.ts:33-50` and `apps/api/src/health-data/health-data.repository.ts`).

### L1-1 — `HealthConnectProvider` imports its native library eagerly, unlike every sibling adapter
- **Severity:** medium (crash impact unconfirmed; to be verified)
- **Where:** `apps/mobile/src/integrations/health/health-connect.provider.ts:12-19` (top-level `import … from "react-native-health-connect"`), pulled in unconditionally by `device-health-provider.ts:1-15`. Siblings use a lazy `require` in `try/catch`: `integrations/auth/google.ts:45`, `auth/apple.ts:32`, `location/location-provider.ts:55`, `maps/route-map.tsx:56`.
- **Scenario:** `getDeviceHealthProvider()` is imported by cross-platform screens (`features/home/stat-strip.tsx`, `features/progress/step-count-card.tsx`, `features/run/use-run-session.ts`), so the Android-only module is evaluated on iOS and in Expo Go; if it throws at import, those screens crash instead of degrading to "unavailable".
- **Rule / ADR:** rule 17 satisfied on the letter; breaks the degrade-safely convention of ADR-041/048/050 adapters.
- **Verified by the session (2026-09-25):** the library's `src/index.tsx:46-56` returns a throwing `Proxy`
  on iOS (it throws only when a method is called, not on import), and the app never calls it on iOS, so
  **iPhone does not crash**. On Android with TurboModules on, the import runs
  `TurboModuleRegistry.getEnforcing('HealthConnect')` (`NativeHealthConnect.ts:72`), which throws at
  import when the native module is missing — i.e. **Android Expo Go** would crash on any screen importing
  the provider. The dev-client build includes the module, so the practical impact is limited to Android
  Expo Go. Recommended severity: **low**.
- **Suggested fix:** lazy `require` inside the provider with the same "unavailable" fallback.
- **Known gap?** no

## Checked and clean
CI conformance script runs clean; domain purity (rules 1-2); workout engine never calls health providers (rules 3, 17), run screen goes through `HealthProvider`; newer adapters (maps, location, Google/Apple sign-in) isolated and lazy; no dodge patterns (dynamic import/re-export); single `api/v1` prefix (rule 7); leaderboard snapshot recomputes (rule 9); health upsert keyed by (user, source, provider record) (rule 10); InBody `calculated` flag; Supabase SDK only in adapters (rule 11); no edge functions (rule 13); migrations 0000-0027 sequential (rule 14, drift not machine-checked); no RLS-only rules (rule 12); the 2026-09-10 H8 grep fix holds.

## Process note
The lane brief pointed at `whole-app-review-plan.md`, which landed one commit after the pin (c789388); the lane read it from there. Not a code defect.
