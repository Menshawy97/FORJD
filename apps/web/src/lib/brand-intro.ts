/**
 * The header logo's one-time intro, animation #4 "Reveal" from the FORJD Logo canvas (ADR-052).
 *
 * The motion lives in global.css under `html.brand-intro`; this module owns the one decision
 * worth testing: whether this page load should play it. The rule the user chose is "when you
 * open or refresh the page" -- arriving from outside the site, or reloading -- and not when
 * clicking from one page of the site to another, which on a static multi-page site is also a
 * full page load. Reduced motion always wins.
 *
 * Like reveal.ts, it is free of `window`/`document` lookups so Vitest can run it in node, and
 * the inline snippet is built from the tested function's own source.
 */

/** The class on <html> that switches the header animation on. */
export const BRAND_INTRO_CLASS = 'brand-intro';

export interface BrandIntroInput {
  /** PerformanceNavigationTiming.type: 'navigate' | 'reload' | 'back_forward' | 'prerender'. */
  navType: string;
  referrer: string;
  origin: string;
  reducedMotion: boolean;
}

export function shouldPlayBrandIntro(input: BrandIntroInput): boolean {
  if (input.reducedMotion) return false;
  if (input.navType === 'reload') return true;
  if (input.navType === 'back_forward') return false;
  if (!input.referrer) return true;
  try {
    return new URL(input.referrer).origin !== input.origin;
  } catch {
    return true;
  }
}

/**
 * Runs inline in <head>, before first paint, so the brand never paints in place and then
 * jumps to its starting frame. Wrapped so a throw leaves a static logo, never a hidden one.
 */
export const brandIntroBootSnippet = `try{var n=window.performance&&window.performance.getEntriesByType?window.performance.getEntriesByType('navigation')[0]:null;if((${shouldPlayBrandIntro.toString()})({navType:n&&n.type||'navigate',referrer:document.referrer||'',origin:window.location.origin,reducedMotion:!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)}))document.documentElement.classList.add(${JSON.stringify(BRAND_INTRO_CLASS)})}catch(e){}`;
