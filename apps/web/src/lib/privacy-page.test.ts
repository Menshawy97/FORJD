import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The privacy policy page is public legal text. It must not ship with the operator name still a placeholder, with a draft banner,
// or with the footer pointing at a Terms section that is not on the page.
const page = readFileSync(new URL('../pages/privacy.astro', import.meta.url), 'utf8');
const footer = readFileSync(new URL('../components/Footer.astro', import.meta.url), 'utf8');

describe('privacy policy page', () => {
  it('names who runs FORJD (the placeholder is replaced)', () => {
    expect(page).not.toContain('OPERATOR_NAME_TO_FILL');
  });

  it('is not marked as a draft', () => {
    expect(page).not.toMatch(/Draft, not legal text|To be written/i);
  });

  it('says what it collects and who receives it, including push notifications', () => {
    for (const id of ['collect', 'share', 'notifications', 'control', 'children', 'website']) {
      expect(page).toContain(`id="${id}"`);
    }
    expect(page).toMatch(/Expo/);
    expect(page).toMatch(/Health data never reaches an analytics or advertising service/);
  });

  it('says what the waitlist email is for, when it is deleted and how to be removed sooner (W4 step 3)', () => {
    expect(page).toMatch(/waitlist on our website, we use your email address only to tell you when FORJD\s+launches/);
    expect(page).toMatch(/Waitlist email addresses are deleted once the launch email has been sent/);
    expect(page).toMatch(/To be removed sooner,\s+email <a href=\{`mailto:\$\{supportEmail\}`\}>\{supportEmail\}<\/a>/);
  });

  it('links only to sections that exist on the page', () => {
    const ids = new Set([...page.matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]));
    const linked = [...(page + footer).matchAll(/\/privacy#([a-z-]+)|href="#([a-z-]+)"/g)].map((m) => m[1] ?? m[2]);
    for (const target of linked) expect(ids.has(target as string)).toBe(true);
  });
});
