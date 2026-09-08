import type { ReadinessComponentKey, ReadinessResult } from "./readiness";

/**
 * The Health tab's "FORJD Insight" -- **not** "AI Insight" (ADR-030; the design's own demo
 * label is exactly the fabrication that ADR names and forbids). Deliberately not a separate
 * heuristic: every sentence this file can produce is derived directly from
 * `computeReadiness`'s own already-cited, already-tested output (the SWC-threshold labels and
 * real recent/baseline values) rather than a second, independent rule set layered on top --
 * "well backed with references and data, not random" means reading the real numbers that were
 * already computed with real methodology, not inventing new copy logic.
 *
 * The one piece of guidance this file adds beyond restating the numbers -- recommending an
 * easier day when a component is meaningfully below baseline -- is itself cited: Plews,
 * Laursen, Stanley, Kilding & Buchheit (2013), *Training adaptation and heart rate variability
 * in elite endurance athletes: opening the door to effective monitoring*, Sports Medicine
 * 43(9):773-781, doi:10.1007/s40279-013-0071-8 (also R9 in ADR-031) -- their smallest-
 * worthwhile-change method is what `readiness.ts` uses to decide a component crossed the
 * threshold in the first place, and their own paper is what recommends easing training load
 * when it crosses downward. This file adds no threshold, no weighting, and no claim beyond
 * what that source and `readiness.ts`'s own computation already establish.
 */

export interface HealthInsightSentence {
  headline: string;
  body: string;
}

const COMPONENT_NAME: Record<ReadinessComponentKey, string> = {
  hrv: "HRV",
  resting_heart_rate: "Resting heart rate",
  sleep_duration: "Sleep",
  respiratory_rate: "Respiratory rate",
};

/**
 * `null` when the composite itself is withheld (too little history, per `readiness.ts`'s own
 * `MIN_BASELINE_DAYS` gate) -- there is nothing true to say about a trend that cannot yet be
 * measured, the same standing rule `progress-insight.ts`'s `MIN_WEEKS_OF_HISTORY` gate
 * enforces for training insight.
 *
 * Otherwise picks the single most-deviated component (by `|score - 50|`, `readiness.ts`'s own
 * distance-from-neutral measure) and reports it factually: which metric, which direction, and
 * -- only when the deviation is unfavorable ("low") -- the one evidence-backed suggestion this
 * file makes. A favorable ("elevated") deviation is reported as a fact with no instruction
 * attached, mirroring `progress-insight.ts`'s own discipline of never implying "more is
 * better" from a single data point.
 */
export function evaluateHealthInsight(readiness: ReadinessResult): HealthInsightSentence | null {
  if (readiness.score === null) return null;

  const deviating = readiness.components
    .filter((c) => c.label !== null && c.label !== "normal" && c.score !== null)
    .sort((a, b) => Math.abs((b.score as number) - 50) - Math.abs((a.score as number) - 50))[0];

  if (!deviating) {
    return {
      headline: "Steady.",
      body: "Every tracked metric is within its normal range for you today.",
    };
  }

  const name = COMPONENT_NAME[deviating.key];

  if (deviating.label === "elevated") {
    return {
      headline: `${name} is favorable today.`,
      body: `Your recent ${name.toLowerCase()} reading is running better than your own baseline for this metric, a sign of good recovery.`,
    };
  }

  return {
    headline: `${name} is below your normal range.`,
    body: `Your recent ${name.toLowerCase()} reading has moved meaningfully below your own baseline. HRV-guided training research (Plews et al., 2013) recommends treating a day like this as lighter or easier rather than pushing a hard session.`,
  };
}
