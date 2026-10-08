import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The terms page is public legal text. It must name who runs FORJD, carry no draft or reviewer notes, cover every section the owner
// approved, only link to anchors that exist, and be reachable from the footer.
const page = readFileSync(new URL('../pages/terms.astro', import.meta.url), 'utf8');
const footer = readFileSync(new URL('../components/Footer.astro', import.meta.url), 'utf8');

describe('terms of use page', () => {
  it('names who runs FORJD and the law that applies', () => {
    expect(page).toContain('Mostafa Ashraf, an individual based in Egypt');
    expect(page).toMatch(/governed by the law of <strong>Egypt<\/strong>, and the courts of <strong>Cairo<\/strong>/);
  });

  it('carries no draft, placeholder or reviewer notes', () => {
    expect(page).not.toMatch(/\[Reviewer|\[date|\[legal name|Draft|TODO|TO_FILL|To be written/i);
  });

  it('has the fourteen approved sections', () => {
    for (const id of ['who', 'what', 'content', 'fair', 'services', 'notifications', 'plans', 'rights', 'risk', 'liability', 'breach', 'ending', 'changes', 'contact']) {
      expect(page).toContain(`id="${id}"`);
    }
    expect(page).toMatch(/not medical advice/);
    expect(page).toMatch(/Some FORJD features are free and some need a paid plan/);
    expect(page).toMatch(/indirect, incidental or consequential damages/);
  });

  it('links only to sections that exist, and to the privacy policy', () => {
    const ids = new Set([...page.matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]));
    for (const m of page.matchAll(/href="#([a-z-]+)"/g)) expect(ids.has(m[1] as string)).toBe(true);
    expect(page).toContain('href="/privacy"');
  });

  it('is linked from the footer', () => {
    expect(footer).toContain('href="/terms"');
  });
});
