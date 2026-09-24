// Renders the app's icon and splash PNGs from the FORJD symbol (ADR-052), on the DARK tile the
// user chose: Graphite #1B1B1D with the ember mark. Run from apps/mobile when the mark changes:
//   node scripts/make-icons.mjs
// then commit the PNGs. The icon only reaches phones with the next native build.
//
// `sharp` is borrowed from apps/web (which already depends on it for its own og/touch icons)
// rather than added to the app's dependencies for a script that never ships in the bundle.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(new URL('../../web/package.json', import.meta.url))('sharp');

const SYMBOL =
  'M8 8H60V24H24V42H60V58H24V92H8ZM64.5 8H92V66A26 26 0 0 1 66 92H40V76H66A10 10 0 0 0 76 66V24H64.5Z';
const EMBER = '#E9712F';
const GRAPHITE = '#1B1B1D';
const INK = '#101011';

// The canvas's app-icon tile: an 88px mark on a 160px tile.
const TILE_MARK = 88 / 160;
// Android adaptive icons show only the middle 72dp of a 108dp canvas; the mark keeps the same
// share of that visible area as it has of the iOS tile.
const ADAPTIVE_MARK = TILE_MARK * (72 / 108);

const out = (name) => fileURLToPath(new URL(`../assets/images/${name}`, import.meta.url));

function svg(size, { background, mark, color, radius = 0 }) {
  const markPx = Math.round(size * mark);
  const offset = Math.round((size - markPx) / 2);
  const bg = background ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${background}"/>` : '';
  const symbol = mark
    ? `<svg x="${offset}" y="${offset}" width="${markPx}" height="${markPx}" viewBox="0 0 100 100"><path fill="${color}" d="${SYMBOL}"/></svg>`
    : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${bg}${symbol}</svg>`);
}

const render = (name, buffer) => sharp(buffer).png().toFile(out(name));

await Promise.all([
  // iOS and the store listing: full-bleed, since both platforms round the corners themselves.
  render('icon.png', svg(1024, { background: GRAPHITE, mark: TILE_MARK, color: EMBER })),
  render('android-icon-background.png', svg(1024, { background: GRAPHITE, mark: 0 })),
  render('android-icon-foreground.png', svg(1024, { mark: ADAPTIVE_MARK, color: EMBER })),
  render('android-icon-monochrome.png', svg(1024, { mark: ADAPTIVE_MARK, color: '#FFFFFF' })),
  // Web tab icon: the tile with its corners, as the website's favicon.svg draws it.
  render('favicon.png', svg(48, { background: GRAPHITE, mark: TILE_MARK, color: EMBER, radius: 10 })),
  // The native splash shows only its Ink background, so it hands straight over to the #9 intro
  // (which starts on the same #101011 with nothing drawn yet) without a visible jump.
  render('splash-icon.png', svg(76, { background: null, mark: 0 })),
]);
console.log('icons written; ink background for the splash is', INK);
