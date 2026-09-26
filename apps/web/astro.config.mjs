// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

import { cspConfig } from './src/lib/security.ts';

// Static output only (ADR-051): Cloudflare Pages serves the built files, with no functions.
// `security.csp`: see src/lib/security.ts; the response headers are in public/_headers.
export default defineConfig({
  site: 'https://getforjd.com',
  output: 'static',
  integrations: [sitemap()],
  security: { csp: cspConfig },
});
