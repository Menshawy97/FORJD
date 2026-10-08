import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteJsonLd } from './seo';

const SITE = 'https://getforjd.com/';

describe('structured data for the home page', () => {
  const data = siteJsonLd(SITE);
  const graph = data['@graph'] as Array<Record<string, unknown>>;
  const byType = (type: string) => graph.find((node) => node['@type'] === type);

  it('says who FORJD is: an organization, a website and a software application', () => {
    expect(data['@context']).toBe('https://schema.org');
    expect(byType('Organization')).toMatchObject({ name: 'FORJD', url: SITE });
    expect(byType('WebSite')).toMatchObject({ name: 'FORJD', url: SITE });
    expect(byType('SoftwareApplication')).toMatchObject({ name: 'FORJD', applicationCategory: 'HealthApplication' });
  });

  it('names the ways people search for it', () => {
    expect((byType('WebSite') as { alternateName: string[] }).alternateName).toEqual(expect.arrayContaining(['FORJD app', 'Get FORJD']));
  });

  it('uses absolute addresses on the real site and survives being written into a page', () => {
    const json = JSON.stringify(data);
    expect(JSON.parse(json)).toEqual(data);
    expect(json).not.toContain('localhost');
    expect(json).not.toContain('</script');
  });

  it('claims nothing that is not true: no ratings, reviews, prices or download links', () => {
    const json = JSON.stringify(data);
    for (const claim of ['aggregateRating', 'review', 'offers', 'price', 'downloadUrl', 'installUrl']) expect(json).not.toContain(claim);
  });
});

describe('page titles and descriptions', () => {
  const dir = new URL('../pages/', import.meta.url);
  const pages = readdirSync(dir)
    .filter((file) => file.endsWith('.astro') && file !== '404.astro')
    .map((file) => {
      const source = readFileSync(new URL(file, dir), 'utf8');
      return {
        file,
        title: /title="([^"]+)"/.exec(source)?.[1] ?? '',
        description: /description="([^"]+)"/.exec(source)?.[1] ?? '',
      };
    });

  it('finds every page', () => {
    expect(pages.map((p) => p.file).sort()).toEqual(['features.astro', 'index.astro', 'privacy.astro', 'support.astro', 'terms.astro']);
  });

  it('gives every page its own title and its own description', () => {
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.description)).size).toBe(pages.length);
  });

  it('keeps titles short enough to show in full, and descriptions long enough to say something', () => {
    for (const page of pages) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.title.length).toBeLessThanOrEqual(60);
      expect(page.description.length).toBeGreaterThanOrEqual(60);
      expect(page.description.length).toBeLessThanOrEqual(170);
    }
  });

  it('puts "FORJD app" in the home page title and description', () => {
    const home = pages.find((p) => p.file === 'index.astro');
    expect(home?.title).toMatch(/FORJD app/);
    expect(home?.description).toMatch(/FORJD app/);
  });
});
