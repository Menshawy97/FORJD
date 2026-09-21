/**
 * Scroll-reveal logic for getforjd.com (W6).
 *
 * The motion itself lives in CSS; this module owns the two decisions that are worth
 * testing — whether to animate at all, and how far apart staggered children start —
 * plus a thin wrapper over IntersectionObserver that guarantees an element is revealed
 * exactly once. It is deliberately free of `document` and `window` lookups so it can be
 * unit-tested in Vitest's node environment, the same way src/lib/pricing.ts is.
 *
 * The numbers come from measuring sayapp.net rather than guessing: a 0.7s transition on
 * cubic-bezier(.16, 1, .3, 1), children stepped 0.12s apart. See the W6 section of
 * docs/product/website-plan.md.
 */

/** The measured interval between staggered children, in milliseconds. */
export const STAGGER_STEP_MS = 120;

/**
 * The ceiling on a stagger. Past roughly a second the last child of a long list is still
 * invisible well after its section has settled, which reads as a bug rather than a
 * flourish, so the delay stops growing at the eighth child.
 */
export const MAX_STAGGER_MS = STAGGER_STEP_MS * 8;

/** The subset of Window this module needs. Narrow on purpose, so tests can fake it. */
export interface RevealWindow {
  matchMedia?: (query: string) => { matches: boolean };
  IntersectionObserver?: unknown;
}

/** The subset of IntersectionObserverEntry the controller reads. */
export interface RevealEntry {
  target: Element;
  isIntersecting: boolean;
}

/** The subset of IntersectionObserver the controller drives. */
export interface ObserverLike {
  observe(element: Element): void;
  unobserve(element: Element): void;
  disconnect(): void;
}

export type ObserverFactory = (callback: (entries: RevealEntry[]) => void) => ObserverLike;

export interface RevealControllerOptions {
  observerFactory: ObserverFactory;
  onReveal: (element: Element) => void;
}

export interface RevealController {
  observe(elements: Iterable<Element>): void;
  stop(): void;
}

/**
 * Whether the page should animate at all.
 *
 * Two ways to answer no, and both matter. A reader who has asked their system for reduced
 * motion gets none of it -- movement of this size is a genuine problem for vestibular
 * disorders, and this is the part of sayapp.net's implementation we deliberately do not
 * copy. A browser without IntersectionObserver also gets none, because the CSS starting
 * state is only ever applied once this returns true; nothing would switch it back off.
 */
export function shouldAnimate(win: RevealWindow | undefined): boolean {
  if (!win || typeof win.matchMedia !== 'function') return false;
  if (!win.IntersectionObserver) return false;
  return !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How long after its section a staggered child should start moving, in milliseconds. */
export function staggerDelayMs(index: number, step: number = STAGGER_STEP_MS): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(Math.floor(index) * step, MAX_STAGGER_MS);
}

/**
 * Reveals each observed element the first time it intersects, then forgets it.
 *
 * Two things keep this once-only. Unobserving stops the browser reporting the element
 * again, which is what prevents a replay when the reader scrolls back up. The revealed
 * set is the belt to that braces: one observer callback can carry several entries, and
 * nothing promises the same target appears at most once in a batch, so the guarantee
 * belongs to this controller rather than to the browser.
 */
export function createRevealController({
  observerFactory,
  onReveal,
}: RevealControllerOptions): RevealController {
  const revealed = new Set<Element>();

  const observer = observerFactory((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || revealed.has(entry.target)) continue;
      revealed.add(entry.target);
      observer.unobserve(entry.target);
      onReveal(entry.target);
    }
  });

  return {
    observe(elements) {
      for (const element of elements) {
        if (!revealed.has(element)) observer.observe(element);
      }
    },
    stop() {
      observer.disconnect();
    },
  };
}
