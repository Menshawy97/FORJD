// Builds public/og.png, the 1200 x 630 link-preview image, from two real app screens on the
// brand's ember background. Run from apps/web when the screens change: node scripts/make-og.mjs
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const WIDTH = 1200;
const HEIGHT = 630;
const PHONE_HEIGHT = 560;
const PHONE_WIDTH = Math.round((396 / 827) * PHONE_HEIGHT);
const TOP = Math.round((HEIGHT - PHONE_HEIGHT) / 2);
const GAP = 48;

const local = (path) => fileURLToPath(new URL(path, import.meta.url));

const background = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <radialGradient id="ember" cx="50%" cy="-10%" r="95%">
      <stop offset="0" stop-color="#e9712f" stop-opacity=".22"/>
      <stop offset=".55" stop-color="#101011" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="#101011"/>
  <rect width="100%" height="100%" fill="url(#ember)"/>
</svg>`);

const phone = (file) => sharp(local(`../src/assets/screens/${file}`)).resize({ height: PHONE_HEIGHT }).toBuffer();

// Not welcome.png: its feature list says "AI Insights", and FORJD's insights are rules-based.
const [home, rank] = await Promise.all([phone('home.png'), phone('rank.png')]);
const left = Math.round((WIDTH - (PHONE_WIDTH * 2 + GAP)) / 2);

await sharp(background)
  .composite([
    { input: home, top: TOP, left },
    { input: rank, top: TOP, left: left + PHONE_WIDTH + GAP },
  ])
  .png({ compressionLevel: 9 })
  .toFile(local('../public/og.png'));
