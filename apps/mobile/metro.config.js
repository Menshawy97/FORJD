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
//
// This has to stay the whole workspace root, not just the two package directories --
// pnpm's shared virtual store (node_modules/.pnpm) lives at the workspace root too, and
// Metro needs it in scope to resolve into symlinked packages like expo-router's own entry
// point. Narrowing this to only packages/domain and packages/contracts was tried and broke
// `Unable to resolve module .../expo-router/entry.js` outright -- confirmed by actually
// running a Metro export, not assumed. See the blockList below instead for excluding the
// one thing that needs excluding without breaking resolution.
config.watchFolders = [workspaceRoot];

// Metro does not resolve symlinks by default; pnpm's whole node_modules strategy
// is built on them (both for the workspace packages above and for pnpm's internal
// dependency layout).
config.resolver.unstable_enableSymlinks = true;

// The workspace's shared pnpm store can contain more than one react-native version --
// e.g. a stray one pulled in purely as apps/api's drizzle-orm's optional peer on
// expo-sqlite, unrelated to this app, which pins react-native@0.81.5 directly. Metro's
// codegen scans every react-native copy its file watcher can see for native spec files,
// not just the one this app's own import graph resolves to, and a newer copy's spec
// syntax (e.g. `ReadonlyArray`) can be unparseable by an older RN's codegen -- producing a
// crash in Expo Go from a package this app never actually imports. Confirmed by tracing a
// real crash to exactly this: node_modules/.pnpm/react-native@0.86.2.../specs_DEPRECATED/
// DebuggingOverlayNativeComponent.js. `getDefaultConfig`'s own blockList is an array
// (confirmed at runtime), appended to rather than replaced.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList]),
  /node_modules[\\/]\.pnpm[\\/]react-native@(?!0\.81\.5)/,
  // `watchFolders = [workspaceRoot]` above sweeps in `.claude/worktrees/*` too, since those
  // git worktrees live inside the repo root. Each worktree has its own independent
  // node_modules; when a *different* session's worktree is mid-install or mid-cleanup while
  // this one is running, Metro's low-level directory watcher (metro-file-map's
  // FallbackWatcher) can hit an ENOENT on a path that existed when it started walking but
  // was gone by the time it tried to watch it -- an unhandled exception that crashes the
  // whole dev server, not a resolution error blockList would normally guard against.
  // Confirmed live: this app never imports anything from a sibling worktree, so excluding
  // the entire directory from Metro's scan is safe and costs nothing.
  /[\\/]\.claude[\\/]worktrees[\\/]/,
];

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
