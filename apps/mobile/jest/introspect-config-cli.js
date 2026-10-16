// Run by jest/introspect-config.ts in its own Node process: prints the introspected config as JSON,
// what `npx expo config --type introspect --json` prints. A child process because Jest gives each test
// its own copy of process.env, which Expo's config loading does not read.
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const projectRoot = join(__dirname, '..');
// Resolved through `@expo/cli`, the code behind `npx expo config`, so the versions are the ones the CLI
// and prebuild use. Resolving through `expo` instead finds an older @expo/prebuild-config (8.x) that
// pnpm also keeps, which adds an extra Android URL scheme the real build does not have.
const expoPackage = require.resolve('expo/package.json', { paths: [projectRoot] });
const fromCli = { paths: [require.resolve('@expo/cli/package.json', { paths: [expoPackage] })] };
const { getPrebuildConfigAsync } = require(require.resolve('@expo/prebuild-config', fromCli));
const { compileModsAsync } = require(
  require.resolve('@expo/config-plugins/build/plugins/mod-compiler.js', fromCli),
);

async function main() {
  const platforms = ['ios', 'android'];
  const config = await getPrebuildConfigAsync(projectRoot, { platforms });
  // The plugins run against an empty folder: introspection reads android/ and ios/ files when they
  // exist and Expo's template only when they do not, and a local prebuild leaves a gitignored android/
  // behind. EAS builds from a clean clone, so the template is what ships (and what CI sees).
  const emptyRoot = mkdtempSync(join(tmpdir(), 'forjd-introspect-'));
  try {
    await compileModsAsync(config.exp, {
      projectRoot: emptyRoot,
      platforms,
      introspect: true,
      assertMissingModProviders: false,
    });
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify(config.exp));
}

main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error));
  process.exit(1);
});
