/**
 * Boots the scroll motion described in W6 of docs/product/website-plan.md.
 *
 * The starting state is switched on earlier than this, by an inline script in <head> (see
 * motionBootSnippet in reveal.ts), so the page never paints visible and then fades out.
 * Nothing in the served HTML is hidden: that script adds `.fj-motion` only after
 * shouldAnimate confirms the browser supports the work and the reader has not asked for
 * reduced motion. Anything that does not run scripts -- a crawler, a link preview -- sees
 * the finished page.
 *
 * This module's job is to report in and then release the hidden content. It reports in
 * first, so the inline script's fail-safe timer does not strip the class, and it removes
 * the class itself if anything below throws, so a bug here degrades to "no animation"
 * rather than to a page that stays invisible.
 */
import { MOTION_CLASS, createRevealController, staggerDelayMs } from './reveal';
import type { RevealController } from './reveal';

const REVEALED = 'is-revealed';

export function bootMotion(doc: Document = document, win: Window = window): void {
  // The inline script decides whether motion is on. If it did not add the class -- reduced
  // motion, no IntersectionObserver -- there is nothing to do.
  if (!doc.documentElement.classList.contains(MOTION_CLASS)) return;
  (win as Window & { __fjMotion?: boolean }).__fjMotion = true;

  try {
    wireMotion(doc, win);
  } catch {
    doc.documentElement.classList.remove(MOTION_CLASS);
  }
}

function wireMotion(doc: Document, win: Window): void {
  // The hero is already on screen, so it runs on load rather than on intersection.
  // Its delays are written into the markup as --reveal-delay; this only releases them.
  requestAnimationFrame(() => {
    doc.querySelectorAll('[data-hero]').forEach((el) => el.classList.add(REVEALED));
  });

  // The HRV line is drawn by animating its dash offset from its own length, measured
  // here rather than hard-coded, so editing the chart's points cannot silently
  // desynchronise the number from the path.
  doc.querySelectorAll<SVGGeometryElement>('[data-chart-line]').forEach((line) => {
    const length = Math.ceil(line.getTotalLength());
    line.style.strokeDasharray = String(length);
    line.style.strokeDashoffset = String(length);
  });

  // Children carry their position in the section as an index, not a hand-computed
  // millisecond value: staggerDelayMs owns the step and the clamp, so a long list cannot
  // be given a delay that leaves its tail hidden long after the section has settled.
  doc.querySelectorAll<HTMLElement>('[data-stagger]').forEach((el) => {
    el.style.setProperty('--reveal-delay', staggerDelayMs(Number(el.dataset.stagger)) + 'ms');
  });

  // The chart is revealed as one unit, by observing the <svg> itself rather than each bar.
  // On a phone the chart sits in a horizontally scrolling box, so bars clipped off its
  // right edge are never "intersecting" and would stay collapsed until the reader happened
  // to scroll sideways -- leaving a chart that looks half-drawn.
  //
  // threshold 0 with a bottom rootMargin, rather than a 15% ratio: a ratio can never be
  // reached by an element more than about 6.7 viewports tall, which would leave it hidden
  // for good, whereas "has crossed the line 10% up from the bottom" works at any height.
  const controller = createRevealController({
    observerFactory: (callback) =>
      new IntersectionObserver((entries) => callback(entries), {
        threshold: 0,
        rootMargin: '0px 0px -10% 0px',
      }),
    onReveal: (element) => {
      element.classList.add(REVEALED);
      if (element.hasAttribute('data-chart')) drawChart(element);
    },
  });

  controller.observe(doc.querySelectorAll('[data-reveal], [data-chart]'));
  keepSweeping(controller, doc, win);
}

/**
 * Catches elements the reader is already past, which IntersectionObserver never reports
 * (see RevealController.sweep). An anchor link, a scroll restored on back/forward, and
 * ordinary scrolling all fire a scroll event; pageshow and hashchange cover the rest. Work
 * is coalesced to one pass per frame and the pending list is short, so this is cheap.
 */
function keepSweeping(controller: RevealController, doc: Document, win: Window): void {
  let queued = false;
  const sweep = () => {
    queued = false;
    controller.sweep((el) => el.getBoundingClientRect().bottom < 0);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sweep);
  };

  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('pageshow', schedule);
  win.addEventListener('hashchange', schedule);
  // Restoring a scroll position or an anchor jump can land after this runs.
  if (doc.readyState === 'complete') schedule();
  else win.addEventListener('load', schedule, { once: true });
}

/** Grows the bars and traces the line inside a chart the reader has just scrolled to. */
function drawChart(chart: Element): void {
  chart.querySelectorAll('[data-chart-bar]').forEach((bar) => bar.classList.add(REVEALED));
  chart.querySelectorAll<SVGElement>('[data-chart-line]').forEach((line) => {
    line.style.strokeDashoffset = '0';
  });
}
