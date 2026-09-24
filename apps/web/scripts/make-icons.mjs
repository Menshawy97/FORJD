// Builds public/apple-touch-icon.png (180 x 180) from the FORJD symbol on the DARK tile
// (ADR-052). iOS rounds the corners itself, so the tile is full-bleed. Run from apps/web when
// the mark changes: node scripts/make-icons.mjs
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const SIZE = 180;
// The symbol's own 8-unit margin inside its 100-unit box already pads it; 62% of the tile
// matches the canvas's 88px mark on a 160px tile (55%) plus that margin.
const MARK = Math.round(SIZE * 0.62);
const OFFSET = Math.round((SIZE - MARK) / 2);
const SYMBOL =
  'M8 8H60V24H24V42H60V58H24V92H8ZM64.5 8H92V66A26 26 0 0 1 66 92H40V76H66A10 10 0 0 0 76 66V24H64.5Z';

const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect width="100%" height="100%" fill="#1B1B1D"/>
  <svg x="${OFFSET}" y="${OFFSET}" width="${MARK}" height="${MARK}" viewBox="0 0 100 100">
    <path fill="#E9712F" d="${SYMBOL}"/>
  </svg>
</svg>`);

await sharp(svg)
  .png()
  .toFile(fileURLToPath(new URL('../public/apple-touch-icon.png', import.meta.url)));
