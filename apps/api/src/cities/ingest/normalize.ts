import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { parseGeonamesTsv } from './geonames.adapter';
import { normalizeCities } from './normalize-cities';

/**
 * `pnpm --filter @forjd/api cities:normalize`
 *
 * Reads the committed `data/cities.tsv` and writes `data/normalized-cities.json`, the columnar
 * snapshot the city resolver loads (ADR-045). CI regenerates it and runs `git diff
 * --exit-code`, the same gate the exercise and food snapshots use, so a change to the slug rules
 * shows up as a reviewable diff of the real records rather than a silent regrouping of cities.
 * Only this file and the adapter read the vendored TSV, which the conformance check enforces.
 */

const SOURCE = 'geonames-cities15000';
const dataDir = join(__dirname, 'data');

const tsv = readFileSync(join(dataDir, 'cities.tsv'), 'utf8');
const { cities, skipped } = parseGeonamesTsv(tsv);
if (skipped > 0) throw new Error(`cities.tsv has ${skipped} malformed lines; re-vendor it`);

// GeoNames does not version this export, so the pin is the hash of the committed file.
// Line endings are normalized first: a Windows checkout turns the TSV into CRLF, and the pin must
// not change with the platform.
const pin = `sha256:${createHash('sha256').update(tsv.replace(/\r\n/g, '\n')).digest('hex')}`;
const snapshot = normalizeCities(cities, { source: SOURCE, pin });
writeFileSync(join(dataDir, 'normalized-cities.json'), `${JSON.stringify(snapshot)}\n`);

console.log(`cities in: ${cities.length}, kept: ${snapshot.count}, dropped: ${snapshot.dropped.orphanSection} districts with no parent city, ${snapshot.dropped.noSlug} with no slug`);
console.log(`timezones: ${snapshot.timezones.length}`);
