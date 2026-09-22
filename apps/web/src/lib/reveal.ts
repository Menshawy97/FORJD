/**
 * Scroll-reveal logic for getforjd.com (W6).
 *
 * The motion itself lives in CSS; this module owns the two decisions that are worth
 * testing — whether to animate at all, and how far apart staggered children start —
 * plus a thin wrapper over IntersectionObserver that guarantees an element is revealed
 * exactly once. It is deliberately free of `document` and `window` lookups so it can be
 * unit-tested in Vitest's node environment, the same way any other pure module in src/lib/ is.
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

/** The class on <html> that switches the hidden starting states in global.css on. */
export const MOTION_CLASS = 'fj-motion';

/**
 * How long the page script has to report in before the class is taken back off. If the
 * bundle fails to load, nothing would ever reveal the hidden content, so this is what
 * turns a broken script into a page that merely does not animate.
 */
export const MOTION_FALLBACK_MS = 3000;

/** The subset of Window this module needs. Narrow on purpose, so tests can fake it. */
export interface RevealWindow {
  matchMedia?: (query: string) => { matches: boolean };
  IntersectionObserver?: unknown;
}

/** The subset of IntersectionObserverEntry the controller reads. */
export interface RevealEntry {
  target: Element;
  isIntersecting: boolean;
  /** Where the element sits relative to the viewport; negative top means scrolled past. */
  boundingClientRect?: { top: number };
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
  /**
   * Reveals every still-pending element for which `isPast` is true. IntersectionObserver
   * only reports changes, so an element that was below the fold at load and is above it
   * after a jump to an anchor never crosses a threshold and is never reported; this is
   * how those are caught.
   */
  sweep(isPast: (element: Element) => boolean): void;
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

/**
 * Runs inline in <head>, before first paint, and returns the answer to "animate?" by adding
 * MOTION_CLASS. It has to be inline and early: added from a deferred module the class
 * arrives after the page has already painted, so content shows, then fades out, then fades
 * back in. It is built from shouldAnimate itself, so the tested function stays the only
 * definition of the rule, and it ends with the fail-safe timer described on
 * MOTION_FALLBACK_MS. Everything is wrapped so that a throw leaves the page unstyled for
 * motion rather than half-configured.
 */
export const motionBootSnippet = `try{if((${shouldAnimate.toString()})(window)){document.documentElement.classList.add(${JSON.stringify(MOTION_CLASS)});setTimeout(function(){if(!window.__fjMotion)document.documentElement.classList.remove(${JSON.stringify(MOTION_CLASS)})},${MOTION_FALLBACK_MS})}}catch(e){}`;

/** How long after its section a staggered child should start moving, in milliseconds. */
export function staggerDelayMs(index: number, step: number = STAGGER_STEP_MS): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(Math.floor(index) * step, MAX_STAGGER_MS);
}

/**
 * An element that is not on screen but sits above the viewport has already been scrolled
 * past. Landing on /features/#eat, or restoring a scroll position on back/forward, leaves
 * everything above that point permanently un-intersecting, so without this it would stay
 * invisible.
 */
function hasScrolledPast(entry: RevealEntry): boolean {
  return (entry.boundingClientRect?.top ?? 0) < 0;
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
  const pending = new Set<Element>();

  const reveal = (target: Element) => {
    if (revealed.has(target)) return;
    revealed.add(target);
    pending.delete(target);
    observer.unobserve(target);
    onReveal(target);
  };

  const observer = observerFactory((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting || hasScrolledPast(entry)) reveal(entry.target);
    }
  });

  return {
    observe(elements) {
      for (const element of elements) {
        if (revealed.has(element)) continue;
        pending.add(element);
        observer.observe(element);
      }
    },
    sweep(isPast) {
      for (const element of [...pending]) {
        if (isPast(element)) reveal(element);
      }
    },
    stop() {
      observer.disconnect();
    },
  };
}
