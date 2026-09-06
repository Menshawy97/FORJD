/**
 * FORJD Insight — the sentence the Progress and Home cards show about an athlete's own
 * training.
 *
 * **This is not AI, and the card does not claim to be.** The design named it "AI insight"; the
 * heading ships as "FORJD Insight" because a sentence assembled from thresholds and arithmetic
 * is not a model's output, and labelling it as one would be a false claim. See ADR-030.
 *
 * Every rule here is traceable to published evidence, and the evidence constrains what the card
 * may say as much as what it does say:
 *
 * - **R1** ACSM Position Stand (2026), *Resistance Training Prescription for Muscle Function,
 *   Hypertrophy, and Physical Performance in Healthy Adults*, Med Sci Sports Exerc — train each
 *   major muscle group at least twice per week.
 * - **R2** ACSM Position Stand (2009), *Progression Models in Resistance Training for Healthy
 *   Adults*, Med Sci Sports Exerc 41(3):687-708 — increase load 2-10% once the athlete exceeds
 *   the target reps by one or two on consecutive sessions. The only instruction this card gives.
 * - **R3** *The Resistance Training Dose Response* meta-regressions, Sports Medicine (2025),
 *   doi:10.1007/s40279-025-02344-w — gains rise with weekly volume but with diminishing
 *   returns, so a rise is reported as a fact and never as "more is better".
 *
 * Two things it must never say, both because the evidence points the other way:
 *
 * - **No prescribed deload.** PeerJ 2024;12:e16777 found continuous training produced *greater*
 *   isometric and dynamic strength gains than deloading. The design's demo copy ("continue this
 *   trajectory for 2-3 more weeks before deloading") is mock text, not a specification.
 * - **No injury-risk claim from a load spike.** The acute:chronic workload ratio's "sweet spot"
 *   is an artefact of bucketing continuous data; the association disappears when the data are
 *   treated continuously (Impellizzeri et al., 2020). `progress-insight.spec.ts` asserts this
 *   negatively, across every input shape, so the constraint survives a future edit.
 */

export interface InsightInput {
  volumeKgThisWeek: number;
  volumeKgLastWeek: number;
  sessionsThisWeek: number;
  /** Completed weeks of training history. Below `MIN_WEEKS_OF_HISTORY` the card stays silent. */
  weeksOfHistory: number;
  /** A lift whose top set has run past its target reps -- the R2 trigger, or `null`. */
  readyToProgress: { exerciseName: string } | null;
  /** Weekly best estimated one-rep max, oldest first. */
  estimatedOneRepMaxTrendKg: readonly number[];
}

export interface InsightSentence {
  /** The lead clause, rendered bold by the card. */
  headline: string;
  /** The remainder, in regular weight. */
  body: string;
}

/**
 * Two weeks is the least that can support the word "this week" against "last week". Below it
 * there is no comparison to draw and the card renders its empty copy instead.
 */
const MIN_WEEKS_OF_HISTORY = 2;

/**
 * Volume moves a little every week. Remarking on a 2% drift would make the card noise, and
 * would imply a precision that a week of training does not have.
 */
const MIN_NOTEWORTHY_VOLUME_CHANGE_PERCENT = 5;

/** R1's frequency floor: each major muscle group trained at least twice a week. */
const MIN_WEEKLY_SESSIONS = 2;

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function evaluateInsight(input: InsightInput): InsightSentence | null {
  if (input.weeksOfHistory < MIN_WEEKS_OF_HISTORY) return null;

  const thinWeek =
    input.sessionsThisWeek > 0 && input.sessionsThisWeek < MIN_WEEKLY_SESSIONS
      ? " Training each major muscle group at least twice a week is what the current ACSM guidance is built around."
      : "";

  // R2 first: it is the only rule that tells the athlete to do something, so when it applies it
  // is the most useful thing the card can say.
  if (input.readyToProgress) {
    return {
      headline: `${input.readyToProgress.exerciseName} is ready for more load.`,
      body:
        "You have been clearing your target reps with room to spare. The standard next step is to add 2-10% and settle back into the rep range." +
        thinWeek,
    };
  }

  const change = percentChange(input.volumeKgThisWeek, input.volumeKgLastWeek);
  if (change !== null && Math.abs(change) >= MIN_NOTEWORTHY_VOLUME_CHANGE_PERCENT) {
    const direction = change > 0 ? "up" : "down";
    const body =
      change > 0
        ? "Total load moved with it. Gains track weekly volume, though the returns taper as it climbs." +
          thinWeek
        : "A lighter week is a normal part of a training block." + thinWeek;
    return { headline: `Training volume ${direction} ${Math.abs(change)}% this week.`, body };
  }

  const trend = input.estimatedOneRepMaxTrendKg;
  const first = trend.at(0);
  const last = trend.at(-1);
  if (trend.length >= 2 && first !== undefined && last !== undefined && first > 0 && last > first) {
    const gain = Math.round((last - first) * 10) / 10;
    return {
      headline: `Your estimated one-rep max is up ${gain} kg over this window.`,
      body: "That is calculated from your heaviest completed set each week." + thinWeek,
    };
  }

  if (thinWeek) {
    return {
      headline: `${input.sessionsThisWeek} session this week.`,
      body: thinWeek.trim(),
    };
  }

  return null;
}
