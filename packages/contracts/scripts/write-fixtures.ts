/**
 * Writes every entry in `responseFixtures` to packages/contracts/fixtures/<name>.json.
 *
 * Each sample goes through its own schema first, so the files can only ever describe shapes
 * the contract accepts. CI runs this and then fails if the working tree changed: a contract
 * edit that makes a fixture stale therefore stops the build, at which point the Flutter DTOs
 * that mirror the same shape are the next thing to look at.
 *
 * Run with `pnpm --filter @forjd/contracts fixtures`.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { responseFixtures } from '../src/fixtures';

const outDir = join(__dirname, '..', 'fixtures');

mkdirSync(outDir, { recursive: true });

const expected = new Set(Object.keys(responseFixtures).map((name) => `${name}.json`));

// A renamed fixture would otherwise leave its old file behind, and the Dart test would keep
// parsing a shape nothing produces any more.
for (const existing of readdirSync(outDir)) {
  if (existing.endsWith('.json') && !expected.has(existing)) {
    rmSync(join(outDir, existing));
    console.log(`removed stale ${existing}`);
  }
}

for (const [name, { schema, sample }] of Object.entries(responseFixtures)) {
  const parsed = schema.parse(sample) as unknown;

  // Trailing newline so the files are ordinary text and a diff does not report a change
  // that is only a missing terminator.
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`wrote ${name}.json`);
}
