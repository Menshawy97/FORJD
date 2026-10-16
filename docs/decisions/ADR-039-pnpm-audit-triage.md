# ADR-039: `pnpm audit` triage — what gets overridden, what stays

**Status:** Accepted
**Date:** 2026-09-16

## Context

`docs/reviews/2026-09-10-whole-repo-audit.md` recorded `pnpm audit` at 74 findings (1 critical,
51 high), characterized as "all in `eas-cli` build tooling, none on the API request path."
Re-running it on 2026-09-16 (R11, `docs/product/audit-remediation-plan.md`) reproduces the same
totals -- 74 findings, 1 critical, 51 high, 18 moderate, 4 low -- but the "all in `eas-cli`"
part of that characterization does not hold up under closer inspection: 39 of the 74 findings
trace only through `apps/mobile`'s `eas-cli` dependency, but the other 35 do not. Several of
those 35 sit on packages `apps/api` actually depends on at runtime, not just in its dev
tooling:

- **`multer`** (via `@nestjs/platform-express`, which `apps/api` uses to handle every
  multipart upload -- InBody scans, avatar uploads) -- four advisories, three high severity,
  all denial-of-service.
- **`qs`** (via `express`/`body-parser`, which is on every HTTP request `apps/api` serves) --
  two moderate advisories, an array-limit bypass and a DoS.
- **`adm-zip`**, a direct `apps/api` dependency (`^0.6.0`) -- one moderate advisory
  (destination-symlink extraction).

The remainder trace through dev-only tooling: `esbuild` via `drizzle-kit` (a CLI, never
imported at runtime), `fast-uri` via `@nestjs/cli`'s `@angular-devkit` toolchain, and
`uuid`/`decode-uri-component`/`js-yaml`/`@xmldom/xmldom` via `drizzle-orm`'s *optional*
`expo-sqlite` driver dependency, which `apps/api` never imports (it uses the Postgres driver)
but which pnpm's workspace hoisting still installs because `apps/mobile` depends on the same
`expo` toolchain for real.

## Decision

1. **Fix what resolves cleanly with `pnpm.overrides`, regardless of whether it's `eas-cli` or
   not.** Added to `pnpm-workspace.yaml`'s `overrides:` key -- pnpm v10+ moved this setting out
   of `package.json`'s `pnpm.overrides` (which it silently ignores with a warning now) into
   `pnpm-workspace.yaml`:
   - `qs` -> `>=6.16.0` (API request path)
   - `multer` -> `>=2.4.0` (API request path)
   - `@xmldom/xmldom` -> `>=0.9.12`, `fast-uri` -> `>=3.1.6`, `uuid@<11.1.1` -> `>=11.1.1`,
     `decode-uri-component` -> `>=0.4.3`, `js-yaml@<3.15.2` / `js-yaml@>=4.0.0 <4.3.2` ->
     their respective patched floors, `esbuild` -> `>=0.24.3` (dev-tooling-only, but the
     override is free and keeps the audit output smaller going forward).
   - `apps/api/package.json`'s own `adm-zip` dependency bumped `^0.6.0` -> `^0.6.1` directly
     (a direct dependency gets a real version bump, not an override).
2. **`eas-cli`'s own transitive tree (`node-forge`, `tar`, `minimatch`, `ajv`, `diff`, and
   related) is left unresolved.** `eas-cli` is a `devDependency` of `apps/mobile`, invoked only
   by a developer or CI runner typing `eas build`/`eas submit` -- it never ships in the mobile
   bundle and never runs on a server that serves user traffic. Forcing a newer `eas-cli`
   (or a subset of its internals) via `overrides` risks breaking EAS's own build/submit
   pipeline in ways this repo cannot verify without an actual EAS build, which is out of scope
   for a "low-severity security and config batch" slice. This is dev-tooling-only risk (a
   compromised developer or CI machine running `eas build` against a malicious tarball), not
   production risk (nothing in this list runs in the deployed API or in the shipped mobile
   app).
3. **Re-run `pnpm audit` after any future `eas-cli` upgrade** (Expo SDK bumps typically drag one
   along) and re-triage rather than assuming this list is still accurate -- see the drift
   between the audit's original characterization and what re-running it found six days later.

## Consequences

- `pnpm audit` went from 74 findings (1 critical, 51 high, 18 moderate, 4 low) to 33
  (1 critical, 21 high, 8 moderate, 3 low) after `pnpm install` picked up the
  `pnpm-workspace.yaml` overrides and the `adm-zip` bump. Every one of the 33 remaining
  findings now traces exclusively through `eas-cli` (`node-forge`, `tar`, `diff`, `minimatch`,
  `ajv`, `yaml`, `joi`, `ts-deepmerge`, `nanoid`, and one residual `js-yaml` finding inside
  `eas-cli`'s own `@oclif/core` dependency that the blanket `js-yaml` override above did not
  reach) -- so the audit's original "all in `eas-cli`" characterization is, after this slice,
  actually true, where before this slice it was not.
- `pnpm audit`'s total finding count still won't reach zero after this ADR; the `eas-cli`
  subtree accounts for all of what remains, by design (decision 2).
- Anyone re-running the audit and finding new API-request-path packages in the list should
  triage them the same way decision 1 did (a direct dependency bump, or a `pnpm.overrides`
  entry), not assume the whole list is `eas-cli` noise -- that assumption is exactly what this
  ADR found to be stale on 2026-09-16, before this slice landed.
- **Correction (2026-09-16, post-merge CI fixup):** this ADR's claim that `decode-uri-component`
  and `uuid` reach the graph only through `drizzle-orm`'s optional `expo-sqlite` driver
  dependency was wrong. `decode-uri-component` is also a real, always-loaded dependency of
  `query-string`, which `expo-router` imports directly; `uuid` is likewise pulled in by `xcode`
  inside `@expo/config-plugins`, part of `expo`'s own dependency chain. Forcing both to
  ESM-only versions (`decode-uri-component@0.5.0`, `uuid@14.x`, both `"type": "module"`) broke
  every `apps/mobile` Jest suite that imports `expo-router/testing-library`, because
  `jest-expo`'s preset `transformIgnorePatterns` only carves out the react-native/expo package
  family for transformation and pnpm's nested `node_modules/.pnpm/<pkg>/node_modules/<pkg>`
  layout matches the ignore pattern for anything outside that carve-out. Fixed by adding
  `decode-uri-component` and `uuid` to `apps/mobile/jest.config.js`'s `transformIgnorePatterns`
  rather than by loosening the version floor -- the security fix in `pnpm-workspace.yaml`
  itself is unchanged. Anyone touching this override block again should verify against a real
  `apps/mobile` Jest run, not just `pnpm audit`'s finding count, since a version floor that
  "resolves cleanly" in the dependency graph can still break the one consumer that needs the
  older, CJS-only major.

## Amendment (2026-10-16): `@xmldom/xmldom` stays on the 0.8 line

The `>=0.9.12` override broke every iPhone prebuild: all three users (`@expo/plist` 0.8.1 and 0.2.0,
`plist` 3.1.1, even the newest `@expo/plist`) are written for `^0.8.8`, and 0.9's `parseFromString`
throws without a mime type, so prebuild could not read any Info.plist. Android never reads a plist, so
the first EAS iOS simulator build was the first thing to notice ([ios-no-account-plan.md](../product/ios-no-account-plan.md), slice 2).
The override is now `>=0.8.15 <0.9.0`: 0.8.15 is the patched release for every advisory that affects
the 0.8 line (GitHub advisories checked 2026-10-16: GHSA-c7q8-3ch8-vqpv, GHSA-27p8-2357-5qqv,
GHSA-6h8r-xr42-gp59, GHSA-8344-3jmq-59r6, GHSA-x4fp-j954-r2f4, GHSA-965w-775f-mr7g, GHSA-93r5-fhx6-vmg9 and
GHSA-6gmq-8vp8-gcm6 affect up to 0.8.14, patched in 0.8.15; GHSA-w2rr-34g9-rvrj and GHSA-4w3w-2rp5-g8jm up to
0.8.13, patched in 0.8.14; GHSA-2v35-w6hq-6mfw, GHSA-f6ww-3ggp-fr8h, GHSA-x6wf-f3px-wcqx and GHSA-j759-j44w-7fr8
below 0.8.13; GHSA-wh4c-j3r5-mjhp below 0.8.12; the rest affect only 0.9), and `pnpm audit` reports the same totals as before,
with no `@xmldom/xmldom` entry. `apps/mobile/config/__tests__/ios-plist-parse.test.ts` fails if a 0.9 copy
comes back. Revisit when `@expo/plist` supports xmldom 0.9 (lift the `<0.9.0` cap), or when an advisory
lands that 0.8 does not patch (then `pnpm audit` flags it).
