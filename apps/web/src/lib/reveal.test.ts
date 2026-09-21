import { describe, expect, it, vi } from 'vitest';

import {
  MOTION_CLASS,
  MOTION_FALLBACK_MS,
  STAGGER_STEP_MS,
  createRevealController,
  motionBootSnippet,
  shouldAnimate,
  staggerDelayMs,
} from './reveal';
import type { ObserverLike, RevealEntry } from './reveal';

/**
 * A hand-written fake for IntersectionObserver. The repo mocks by hand rather than
 * reaching for a mocking library (see the API's whoop-client.spec.ts), and a fake we
 * drive by hand is the only way to assert that an element is revealed exactly once.
 */
function fakeObserver() {
  const observed = new Set<Element>();
  let observeCalls = 0;
  let fire: (entries: RevealEntry[]) => void = () => {};
  let disconnected = false;

  const factory = (callback: (entries: RevealEntry[]) => void): ObserverLike => {
    fire = callback;
    return {
      observe: (el) => {
        observeCalls += 1;
        observed.add(el);
      },
      unobserve: (el) => observed.delete(el),
      disconnect: () => {
        disconnected = true;
        observed.clear();
      },
    };
  };

  return {
    factory,
    observed,
    observeCalls: () => observeCalls,
    isDisconnected: () => disconnected,
    intersect: (el: Element) => fire([{ target: el, isIntersecting: true }]),
    pass: (el: Element) => fire([{ target: el, isIntersecting: false }]),
    scrolledPast: (el: Element) =>
      fire([{ target: el, isIntersecting: false, boundingClientRect: { top: -400 } }]),
    notYetReached: (el: Element) =>
      fire([{ target: el, isIntersecting: false, boundingClientRect: { top: 900 } }]),
  };
}

/**
 * A stand-in for an Element. The tests deliberately need no DOM: apps/web runs Vitest in
 * its default node environment (pricing.test.ts is pure), and the controller only passes
 * targets through to the observer, so an opaque object exercises it honestly without
 * pulling jsdom into the dependency tree.
 */
let nextId = 0;
const element = () => ({ id: (nextId += 1) }) as unknown as Element;

describe('shouldAnimate', () => {
  const win = (reduced: boolean, hasObserver = true) =>
    ({
      matchMedia: () => ({ matches: reduced }),
      ...(hasObserver ? { IntersectionObserver: class {} } : {}),
    }) as unknown as Parameters<typeof shouldAnimate>[0];

  it('is true in a browser that supports it and is not asking for reduced motion', () => {
    expect(shouldAnimate(win(false))).toBe(true);
  });

  it('is false when the reader prefers reduced motion', () => {
    // Movement of this size is a real problem for vestibular disorders, so the
    // preference switches the whole feature off rather than shortening it.
    expect(shouldAnimate(win(true))).toBe(false);
  });

  it('is false when IntersectionObserver is missing', () => {
    expect(shouldAnimate(win(false, false))).toBe(false);
  });

  it('is false when there is no window at all', () => {
    expect(shouldAnimate(undefined)).toBe(false);
  });

  it('is false when matchMedia is unavailable, rather than throwing', () => {
    expect(shouldAnimate({ IntersectionObserver: class {} } as never)).toBe(false);
  });
});

describe('staggerDelayMs', () => {
  it('steps by 0.12s per index, the measured sayapp.net interval', () => {
    expect(staggerDelayMs(0)).toBe(0);
    expect(staggerDelayMs(1)).toBe(STAGGER_STEP_MS);
    expect(staggerDelayMs(3)).toBe(3 * STAGGER_STEP_MS);
  });

  it('clamps so a long list never waits about a second to start', () => {
    // Without the clamp a twelve-item list would leave the last item hidden for 1.4s
    // after its section arrived, which reads as broken rather than considered.
    expect(staggerDelayMs(12)).toBe(staggerDelayMs(8));
    expect(staggerDelayMs(8)).toBe(960);
  });

  it('treats a negative or non-finite index as no delay', () => {
    expect(staggerDelayMs(-2)).toBe(0);
    expect(staggerDelayMs(Number.NaN)).toBe(0);
  });
});

describe('createRevealController', () => {
  it('reveals an element when it intersects', () => {
    const observer = fakeObserver();
    const onReveal = vi.fn();
    const el = element();

    createRevealController({ observerFactory: observer.factory, onReveal }).observe([el]);
    observer.intersect(el);

    expect(onReveal).toHaveBeenCalledWith(el);
  });

  it('does not reveal an element that is merely observed', () => {
    const observer = fakeObserver();
    const onReveal = vi.fn();
    const el = element();

    createRevealController({ observerFactory: observer.factory, onReveal }).observe([el]);
    observer.pass(el);

    expect(onReveal).not.toHaveBeenCalled();
  });

  it('reveals once and never again, so scrolling back does not replay it', () => {
    const observer = fakeObserver();
    const onReveal = vi.fn();
    const el = element();

    createRevealController({ observerFactory: observer.factory, onReveal }).observe([el]);
    observer.intersect(el);
    observer.intersect(el);

    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(observer.observed.has(el)).toBe(false);
  });

  it('observes every element it is given', () => {
    const observer = fakeObserver();
    const controller = createRevealController({
      observerFactory: observer.factory,
      onReveal: vi.fn(),
    });

    controller.observe([element(), element()]);

    expect(observer.observed.size).toBe(2);
  });

  it('does not observe an element again once it has been revealed', () => {
    // Counting calls is what makes this fail if the guard in observe() is removed; a Set
    // of observed elements would look identical either way.
    const observer = fakeObserver();
    const controller = createRevealController({
      observerFactory: observer.factory,
      onReveal: vi.fn(),
    });
    const [a, b] = [element(), element()];

    controller.observe([a]);
    observer.intersect(a);
    controller.observe([a, b]);

    expect(observer.observeCalls()).toBe(2); // a once, b once
  });

  it('reveals an element the reader has already scrolled past', () => {
    // Landing on /features/#eat, or restoring a scroll position, leaves everything above
    // the fold un-intersecting forever; without this it would stay invisible.
    const observer = fakeObserver();
    const onReveal = vi.fn();
    const el = element();

    createRevealController({ observerFactory: observer.factory, onReveal }).observe([el]);
    observer.scrolledPast(el);

    expect(onReveal).toHaveBeenCalledWith(el);
  });

  it('leaves an element that is still below the viewport hidden', () => {
    const observer = fakeObserver();
    const onReveal = vi.fn();
    const el = element();

    createRevealController({ observerFactory: observer.factory, onReveal }).observe([el]);
    observer.notYetReached(el);

    expect(onReveal).not.toHaveBeenCalled();
  });

  describe('sweep', () => {
    // IntersectionObserver only reports changes. An element that was below the fold when
    // the page loaded and is above it after a jump to #eat never crosses a threshold, so
    // it is never reported and would stay invisible. The sweep is how those get caught.
    it('reveals pending elements the reader is already past', () => {
      const observer = fakeObserver();
      const onReveal = vi.fn();
      const controller = createRevealController({ observerFactory: observer.factory, onReveal });
      const [past, ahead] = [element(), element()];

      controller.observe([past, ahead]);
      controller.sweep((el) => el === past);

      expect(onReveal).toHaveBeenCalledTimes(1);
      expect(onReveal).toHaveBeenCalledWith(past);
      expect(observer.observed.has(past)).toBe(false);
      expect(observer.observed.has(ahead)).toBe(true);
    });

    it('never reveals the same element twice across sweeps and intersections', () => {
      const observer = fakeObserver();
      const onReveal = vi.fn();
      const controller = createRevealController({ observerFactory: observer.factory, onReveal });
      const el = element();

      controller.observe([el]);
      controller.sweep(() => true);
      controller.sweep(() => true);
      observer.intersect(el);

      expect(onReveal).toHaveBeenCalledTimes(1);
    });

    it('reveals nothing when nothing is behind the reader', () => {
      const observer = fakeObserver();
      const onReveal = vi.fn();
      const controller = createRevealController({ observerFactory: observer.factory, onReveal });

      controller.observe([element(), element()]);
      controller.sweep(() => false);

      expect(onReveal).not.toHaveBeenCalled();
    });
  });

  it('stops observing when told to', () => {
    const observer = fakeObserver();
    const controller = createRevealController({
      observerFactory: observer.factory,
      onReveal: vi.fn(),
    });

    controller.observe([element()]);
    controller.stop();

    expect(observer.isDisconnected()).toBe(true);
  });
});

describe('motionBootSnippet', () => {
  /**
   * The snippet runs inline in <head>, before first paint, so the hidden starting state is
   * in place before anything is shown. Adding the class from a deferred module instead let
   * the page paint visible and then fade out, a flash. Running it against a fake window and
   * document proves what it does without a browser.
   */
  function run(opts: { reduced?: boolean; hasObserver?: boolean }) {
    const classes = new Set<string>();
    const timers: Array<() => void> = [];
    const win: Record<string, unknown> = {
      matchMedia: () => ({ matches: opts.reduced ?? false }),
      ...(opts.hasObserver === false ? {} : { IntersectionObserver: class {} }),
    };
    const doc = {
      documentElement: {
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
        },
      },
    };
    const setTimeoutFake = (fn: () => void) => timers.push(fn);
    new Function('window', 'document', 'setTimeout', motionBootSnippet)(win, doc, setTimeoutFake);
    return { classes, timers, win };
  }

  it('enables motion when the browser supports it and the reader has not opted out', () => {
    expect(run({}).classes.has(MOTION_CLASS)).toBe(true);
  });

  it('does nothing for a reader who prefers reduced motion', () => {
    expect(run({ reduced: true }).classes.has(MOTION_CLASS)).toBe(false);
  });

  it('does nothing without IntersectionObserver', () => {
    expect(run({ hasObserver: false }).classes.has(MOTION_CLASS)).toBe(false);
  });

  it('takes the class back off if the page script never reports in', () => {
    // If the bundle fails to load, the class is the only thing hiding content and nothing
    // would ever reveal it. This timer is the difference between a slow page and a blank one.
    const { classes, timers } = run({});
    expect(classes.has(MOTION_CLASS)).toBe(true);
    expect(MOTION_FALLBACK_MS).toBeGreaterThan(0);

    timers.forEach((t) => t());

    expect(classes.has(MOTION_CLASS)).toBe(false);
  });

  it('leaves the class alone once the page script has reported in', () => {
    const { classes, timers, win } = run({});
    win.__fjMotion = true;

    timers.forEach((t) => t());

    expect(classes.has(MOTION_CLASS)).toBe(true);
  });
});
