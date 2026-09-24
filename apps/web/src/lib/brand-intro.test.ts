import { describe, expect, it } from 'vitest';

import { BRAND_INTRO_CLASS, brandIntroBootSnippet, shouldPlayBrandIntro } from './brand-intro';

const ORIGIN = 'https://getforjd.com';

const base = { navType: 'navigate', referrer: '', origin: ORIGIN, reducedMotion: false };

describe('shouldPlayBrandIntro', () => {
  it('plays on a first visit with no referrer (typed URL, bookmark)', () => {
    expect(shouldPlayBrandIntro(base)).toBe(true);
  });

  it('plays when arriving from another site', () => {
    expect(shouldPlayBrandIntro({ ...base, referrer: 'https://www.google.com/' })).toBe(true);
  });

  it('plays on a reload, even though the referrer is this site', () => {
    expect(shouldPlayBrandIntro({ ...base, navType: 'reload', referrer: `${ORIGIN}/features` })).toBe(true);
  });

  it('does not play when moving between pages of the site', () => {
    expect(shouldPlayBrandIntro({ ...base, referrer: `${ORIGIN}/` })).toBe(false);
  });

  it('does not play on back/forward', () => {
    expect(shouldPlayBrandIntro({ ...base, navType: 'back_forward', referrer: 'https://www.google.com/' })).toBe(false);
  });

  it('does not treat a look-alike host as the same site', () => {
    expect(shouldPlayBrandIntro({ ...base, referrer: 'https://getforjd.com.evil.example/' })).toBe(true);
  });

  it('never plays under reduced motion', () => {
    expect(shouldPlayBrandIntro({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldPlayBrandIntro({ ...base, navType: 'reload', reducedMotion: true })).toBe(false);
  });
});

describe('brandIntroBootSnippet', () => {
  it('embeds the class it adds and cannot throw out', () => {
    expect(brandIntroBootSnippet).toContain(JSON.stringify(BRAND_INTRO_CLASS));
    expect(brandIntroBootSnippet.startsWith('try{')).toBe(true);
    expect(brandIntroBootSnippet).toContain('prefers-reduced-motion');
  });

  function runSnippet(referrer: string, navType: string) {
    const added: string[] = [];
    const fakeWindow = {
      location: { origin: ORIGIN },
      matchMedia: () => ({ matches: false }),
      performance: { getEntriesByType: () => [{ type: navType }] },
    };
    const fakeDocument = { referrer, documentElement: { classList: { add: (c: string) => added.push(c) } } };
    new Function('window', 'document', brandIntroBootSnippet)(fakeWindow, fakeDocument);
    return added;
  }

  it('adds the class on a fresh visit', () => {
    expect(runSnippet('', 'navigate')).toEqual([BRAND_INTRO_CLASS]);
  });

  it('adds nothing on an internal link click', () => {
    expect(runSnippet(`${ORIGIN}/features`, 'navigate')).toEqual([]);
  });
});
