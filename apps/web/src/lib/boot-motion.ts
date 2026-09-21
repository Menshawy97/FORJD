/**
 * Boots the scroll motion described in W6 of docs/product/website-plan.md.
 *
 * The order of the first two statements is load-bearing. Nothing in the served HTML is
 * hidden; the `.fj-motion` class is what switches the starting states in global.css on,
 * and it is added only after shouldAnimate has confirmed the browser supports the work
 * and the reader has not asked for reduced motion. Anything that does not run this
 * script -- a crawler, a link preview, a failed bundle -- sees the finished page.
 */
import { createRevealController, shouldAnimate, staggerDelayMs } from './reveal';

const MOTION_CLASS = 'fj-motion';
const REVEALED = 'is-revealed';

export function bootMotion(doc: Document = document, win: Window = window): void {
  if (!shouldAnimate(win)) return;
  doc.documentElement.classList.add(MOTION_CLASS);

  // The hero is already on screen, so it runs on load rather than on intersection.
  // Its delays are written into the markup as --reveal-delay; this only releases them.
  requestAnimationFrame(() => {
    doc.querySelectorAll('[data-hero]').forEach((el) => el.classList.add(REVEALED));
  });

  // The HRV line is drawn by animating its dash offset from its own length, measured
  // here rather than hard-coded, so editing the chart's points cannot silently
  // desynchronise the number from the path.
  const lines = doc.querySelectorAll<SVGGeometryElement>('[data-chart-line]');
  lines.forEach((line) => {
    const length = Math.ceil(line.getTotalLength());
    line.style.strokeDasharray = String(length);
    line.style.strokeDashoffset = String(length);
  });

  // Children carry their position in the section as an index, not a hand-computed
  // millisecond value: staggerDelayMs owns the step and the clamp, so a long list cannot
  // be given a delay that leaves its tail hidden long after the section has settled.
  doc.querySelectorAll<HTMLElement>('[data-stagger]').forEach((el) => {
    const delay = staggerDelayMs(Number(el.dataset.stagger));
    el.style.setProperty('--reveal-delay', delay + 'ms');
  });

  // The chart is revealed as one unit, by observing the <svg> itself rather than each bar.
  // On a phone the chart sits in a horizontally scrolling box, so bars clipped off its
  // right edge are never "intersecting" and would stay collapsed until the reader happened
  // to scroll sideways -- leaving a chart that looks half-drawn.
  const controller = createRevealController({
    observerFactory: (callback) =>
      new IntersectionObserver((entries) => callback(entries), { threshold: 0.15 }),
    onReveal: (element) => {
      element.classList.add(REVEALED);
      if (element.hasAttribute('data-chart')) drawChart(element);
    },
  });

  controller.observe(doc.querySelectorAll('[data-reveal], [data-chart]'));
}

/** Grows the bars and traces the line inside a chart the reader has just scrolled to. */
function drawChart(chart: Element): void {
  chart.querySelectorAll('[data-chart-bar]').forEach((bar) => bar.classList.add(REVEALED));
  chart.querySelectorAll<SVGElement>('[data-chart-line]').forEach((line) => {
    line.style.strokeDashoffset = '0';
  });
}
