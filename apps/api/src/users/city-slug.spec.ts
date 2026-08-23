import { slugifyCity } from './city-slug';

describe('slugifyCity', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugifyCity('New York')).toBe('new-york');
  });

  it('leaves an already-simple name unchanged in shape', () => {
    expect(slugifyCity('Cairo')).toBe('cairo');
  });

  /**
   * The reason this exists: two spellings of the same Latin-script city should group
   * together, which is the whole point of a grouping key. Stripping only combining marks
   * (not full ASCII-folding) is what keeps this correct rather than merely convenient.
   */
  it('strips Latin diacritics so accented and plain spellings group together', () => {
    expect(slugifyCity('Zürich')).toBe('zurich');
    expect(slugifyCity('Zurich')).toBe('zurich');
    expect(slugifyCity('São Paulo')).toBe('sao-paulo');
  });

  it('collapses runs of punctuation into a single hyphen', () => {
    expect(slugifyCity("St. John's")).toBe('st-john-s');
    expect(slugifyCity('Washington, D.C.')).toBe('washington-d-c');
  });

  it('trims leading and trailing hyphens produced by leading/trailing punctuation', () => {
    expect(slugifyCity('  Paris!  ')).toBe('paris');
  });

  /**
   * Characters outside Latin script have no diacritics to strip and nothing this function
   * could safely romanize without a transliteration library the API does not depend on.
   * Lowercasing and keeping them is correct; discarding them (as an ASCII-only filter would)
   * would collapse every non-Latin city name to the same empty string — see the test below
   * for why that would be worse than keeping the script as-is.
   */
  it('keeps non-Latin scripts rather than discarding them', () => {
    expect(slugifyCity('北京')).toBe('北京');
    expect(slugifyCity('Москва')).toBe('москва');
  });

  /**
   * A name that slugifies to nothing — pure punctuation, or a name a future caller failed to
   * validate — must not silently become the empty string. `''` is falsy but not the same as
   * "no slug", and every city with a punctuation-only name would otherwise collide into one
   * group. Returning null makes the caller decide what "no usable slug" means, rather than
   * storing a value that looks present but carries no information.
   */
  it('returns null rather than an empty string when nothing slugifiable remains', () => {
    expect(slugifyCity('!!!')).toBeNull();
    expect(slugifyCity('   ')).toBeNull();
    expect(slugifyCity('')).toBeNull();
  });

  it('collapses distinct sources of the same name to the same slug', () => {
    const alexandria = ['Alexandria', 'alexandria', '  Alexandria  ', 'ALEXANDRIA'];

    const slugs = new Set(alexandria.map(slugifyCity));

    expect(slugs.size).toBe(1);
  });
});
