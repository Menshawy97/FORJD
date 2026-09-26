// 8.5 S8, L8-4: text drawn with `lineHeight` equal to its `fontSize` (the prototype's `/1`
// shorthand) sits in boxes sized to the design, so at the largest system text sizes it clips
// or spills out. The user chose (2026-09-26) to keep the design's spacing exactly and cap how
// far those texts grow, rather than loosen the line height. This scans shipped source so a new
// tight text added later without the cap fails here, not on someone's phone.
import { TIGHT_TEXT_MAX_FONT_SCALE } from '../text-scale';

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * `fontSize: N` and `lineHeight: N` side by side with the same value N, in either order, where N
 * is a literal or a shared name (`fontSize: SIZE, lineHeight: SIZE`). An expression such as
 * `lineHeight: 13.5 * 1.2` is not tight and does not match.
 */
function hasTightPair(text: string): boolean {
  const value = String.raw`([\w.]+)\s*[,}\r\n]`;
  const orders = [
    new RegExp(String.raw`fontSize:\s*${value}\s*lineHeight:\s*${value}`, 'g'),
    new RegExp(String.raw`lineHeight:\s*${value}\s*fontSize:\s*${value}`, 'g'),
  ];
  return orders.some((pattern) => [...text.matchAll(pattern)].some((match) => match[1] === match[2]));
}

/** Every `<Text ...>` opening tag, read up to the `>` that closes it outside any `{...}`. */
function textOpeningTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<Text[\s>]/g)) {
    let depth = 0;
    let end = match.index;
    for (let i = match.index; i < source.length; i += 1) {
      const char = source[i];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) {
        end = i;
        break;
      }
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

/** Names of `const NAME = { ... }` style objects in a file that carry a tight pair. */
function tightStyleConstants(source: string): string[] {
  return [...source.matchAll(/const\s+([A-Z_]+)\s*=\s*\{([^}]*)\}/g)]
    .filter((match) => hasTightPair(match[2] ?? ''))
    .map((match) => match[1] ?? '');
}

function isTight(tag: string, constants: string[]): boolean {
  return hasTightPair(tag) || constants.some((name) => tag.includes(`...${name}`));
}

describe('tight line-height text caps its growth (8.5 S8, L8-4)', () => {
  it('uses a cap that still lets text grow, just not without limit', () => {
    expect(TIGHT_TEXT_MAX_FONT_SCALE).toBeGreaterThan(1);
    expect(TIGHT_TEXT_MAX_FONT_SCALE).toBeLessThanOrEqual(1.5);
  });

  it('finds the tight texts it is guarding (the scanner is not silently matching nothing)', () => {
    const tightFiles = sourceFiles(SRC).filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const constants = tightStyleConstants(source);
      return textOpeningTags(source).some((tag) => isTight(tag, constants));
    });

    expect(tightFiles.length).toBeGreaterThanOrEqual(7);
  });

  it('gives every Text with lineHeight equal to fontSize a maxFontSizeMultiplier', () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const constants = tightStyleConstants(source);
      return textOpeningTags(source)
        .filter((tag) => isTight(tag, constants))
        .filter((tag) => !tag.includes('maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}'))
        .map((tag) => `${path.relative(SRC, file)}: ${tag.slice(0, 60).replace(/\s+/g, ' ')}`);
    });

    expect(offenders).toEqual([]);
  });
});
