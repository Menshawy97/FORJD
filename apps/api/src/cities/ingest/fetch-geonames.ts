import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import AdmZip from 'adm-zip';

import { VENDORED_COLUMNS, filterRawLine } from './geonames.adapter';

/**
 * `pnpm --filter @forjd/api cities:fetch-geonames`
 *
 * Downloads GeoNames' `cities15000` export and writes a **column-filtered** vendor snapshot,
 * `data/cities.tsv` (ADR-045). The raw file is 19 columns and 8.5 MB, most of it alternate
 * names in every script; committing it would put ~6 MB of unread data into git history for
 * good. Filtering is done here, once, so re-vendoring is "run this, review the diff".
 *
 * **GeoNames republishes this file daily and does not version it.** So the pin is the committed
 * `cities.tsv` and its SHA-256, recorded in `data/SOURCE.md`, rather than an upstream release
 * id. The normalizer reads only the committed file, never the network.
 *
 * A bad download must never replace good data, so the write is refused when the result is
 * implausibly small (an error page, a truncated archive, an upstream format change) and is done
 * through a temporary file and a rename, so an interrupted run cannot leave half a file.
 */

const ZIP_URL = 'https://download.geonames.org/export/dump/cities15000.zip';
const ENTRY = 'cities15000.txt';
const TIMEOUT_MS = 60_000;
/** The export has held 25,000-35,000 rows for years. Well below that means something is wrong. */
const MIN_ROWS = 25_000;
/** ...and a re-vendor that loses more than this share of the current rows is refused too. */
const MAX_SHRINK = 0.1;

const outDir = join(__dirname, 'data');
const outFile = join(outDir, 'cities.tsv');

async function main(): Promise<void> {
  const response = await fetch(ZIP_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GET ${ZIP_URL} failed: ${response.status}`);
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const entry = zip.getEntry(ENTRY);
  if (!entry) throw new Error(`${ENTRY} not found in the archive`);

  const lines = zip.readAsText(entry).split(/\r?\n/).filter((line) => line !== '');
  const kept: string[] = [];
  let malformed = 0;
  for (const line of lines) {
    const filtered = filterRawLine(line);
    if (filtered === null) malformed += 1;
    else kept.push(filtered);
  }

  if (kept.length < MIN_ROWS || malformed > kept.length / 100) {
    throw new Error(`refusing to write: ${kept.length} rows kept (need ${MIN_ROWS}), ${malformed} malformed`);
  }
  if (existsSync(outFile)) {
    const current = readFileSync(outFile, 'utf8').split(/\r?\n/).filter((line) => line !== '').length;
    if (kept.length < current * (1 - MAX_SHRINK)) {
      throw new Error(`refusing to write: ${kept.length} rows would replace ${current} (more than ${MAX_SHRINK * 100}% fewer)`);
    }
  }

  // Sorted by id so a re-vendor diffs as real additions and removals, not a reshuffle.
  kept.sort((a, b) => Number(a.split('\t')[0]) - Number(b.split('\t')[0]));
  const text = `${kept.join('\n')}\n`;

  mkdirSync(outDir, { recursive: true });
  const temp = `${outFile}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, outFile);

  const sha256 = createHash('sha256').update(text).digest('hex');
  console.log(`columns: ${VENDORED_COLUMNS.join(', ')}`);
  console.log(`rows in: ${lines.length}, kept: ${kept.length}, malformed: ${malformed}`);
  console.log(`cities.tsv: ${Buffer.byteLength(text)} bytes, sha256 ${sha256}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
