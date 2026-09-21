import { describe, expect, it, vi } from 'vitest';

import { STAGGER_STEP_MS, createRevealController, shouldAnimate, staggerDelayMs } from './reveal';
import type { ObserverLike, RevealEntry } from './reveal';

/**
 * A hand-written fake for IntersectionObserver. The repo mocks by hand rather than
 * reaching for a mocking library (see the API's whoop-client.spec.ts), and a fake we
 * drive by hand is the only way to assert that an element is revealed exactly once.
 */
function fakeObserver() {
  const observed = new Set<Element>();
  let fire: (entries: RevealEntry[]) => void = () => {};
  let disconnected = false;

  const factory = (callback: (entries: RevealEntry[]) => void): ObserverLike => {
    fire = callback;
    return {
      observe: (el) => observed.add(el),
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
    isDisconnected: () => disconnected,
    intersect: (el: Element) => fire([{ target: el, isIntersecting: true }]),
    pass: (el: Element) => fire([{ target: el, isIntersecting: false }]),
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
    expect(staggerDelayMs(40)).toBeLessThanOrEqual(960);
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

  it('observes every element it is given, and is safe to call twice', () => {
    const observer = fakeObserver();
    const controller = createRevealController({
      observerFactory: observer.factory,
      onReveal: vi.fn(),
    });
    const [a, b] = [element(), element()];

    controller.observe([a]);
    controller.observe([a, b]);

    expect(observer.observed.size).toBe(2);
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
