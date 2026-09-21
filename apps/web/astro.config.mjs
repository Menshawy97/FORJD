// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// Static output only (ADR-051): Cloudflare Pages serves the built files, with no functions.
export default defineConfig({
  site: 'https://getforjd.com',
  output: 'static',
  integrations: [sitemap()],
});
