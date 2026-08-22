// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

let config = getDefaultConfig(projectRoot);

// Workspace packages (@forjd/domain, @forjd/contracts) are pnpm symlinks into
// packages/*, which live outside apps/mobile. Metro only watches projectRoot by
// default, so without this it never sees changes in — or resolves imports from —
// the linked-in package source. See the mobile-pivot plan's Phase 3 spike.
config.watchFolders = [workspaceRoot];

// Metro does not resolve symlinks by default; pnpm's whole node_modules strategy
// is built on them (both for the workspace packages above and for pnpm's internal
// dependency layout).
config.resolver.unstable_enableSymlinks = true;

// Deliberately NOT setting disableHierarchicalLookup / a custom nodeModulesPaths here.
// pnpm nests each package's own dependencies inside its own node_modules (e.g.
// node_modules/.pnpm/expo@.../node_modules/expo-modules-core) rather than a flat tree —
// disabling hierarchical lookup breaks Metro's ability to walk up and find those, which
// surfaced as real "Unable to resolve module expo-modules-core" bundling failures during
// the Phase 3 spike (see the mobile-pivot plan). watchFolders + unstable_enableSymlinks is
// the documented Expo pnpm-monorepo setup; this was the extra config the spike's own
// escalation path called for, so it's flagged here — not silently added.

// Wraps the config to compile `global.css`'s Tailwind directives against tailwind.config.ts
// and wire the resulting class -> style lookup into the bundle. Applied last so NativeWind
// wraps the symlink-aware config above rather than the other way around.
config = withNativeWind(config, { input: './src/global.css' });

module.exports = config;
