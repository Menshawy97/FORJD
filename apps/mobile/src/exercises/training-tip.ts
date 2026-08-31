import type { MuscleGroup } from '@forjd/domain';

/**
 * Ports the prototype's `trainingTip(name, muscleStr)` (line 1971 of
 * `FORJD Mobile.dc.html`) verbatim -- the source text for the `s_exercise()` "How to train
 * it" callout. This element was missed entirely during the earlier spec-extraction pass
 * (`docs/design/phase2-screen-specs.md` §4.2 never mentions it); unlike the stat
 * tiles/sparkline/history it needs no session or analytics data, so there is no reason to
 * defer it to Phase 3.
 *
 * The prototype matched against a single space/dot-joined muscle string with `.includes()`;
 * this ports the same eight named exercises and the same four muscle-group buckets against
 * our canonical `MuscleGroup` values instead, since the substring matching was only ever a
 * stand-in for real per-exercise data the prototype didn't have.
 */
const CURATED_TIPS: Record<string, string> = {
  'Bench Press':
    'Keep shoulder blades pinned back and drive through your feet — a stable base lets you press harder without straining the shoulders.',
  'Incline DB Press':
    'Set the bench to 30–45°. Too steep turns it into a shoulder press and takes tension off the upper chest.',
  'Cable Fly':
    "Keep a slight bend in the elbows throughout and squeeze at the midline — let the cable stretch you back, don't chase range with a straight arm.",
  Deadlift:
    'Push the floor away rather than pulling the bar up. Keep the bar against your shins/thighs the whole way to protect your lower back.',
  'Barbell Row':
    'Hinge at the hips, brace your core, and pull to your lower ribs — avoid jerking the weight up with momentum.',
  Squat:
    'Sit back and down with your chest up; drive your knees out over your toes on the way up.',
  'Overhead Press':
    'Brace your glutes and abs to avoid over-arching your lower back as the bar passes your face.',
  'Pull-Up':
    'Start from a dead hang and pull your elbows down and back — think about driving your chest to the bar.',
};

const LEG_MUSCLES: MuscleGroup[] = ['quads', 'hamstrings', 'glutes', 'calves'];
const PUSH_MUSCLES: MuscleGroup[] = ['chest', 'shoulders', 'triceps'];
const PULL_MUSCLES: MuscleGroup[] = ['back', 'lats', 'biceps'];
const CORE_MUSCLES: MuscleGroup[] = ['core'];

const LEG_TIP =
  'Control the eccentric (lowering) phase and drive through your whole foot — most leg gains come from time under tension, not just the top of the rep.';
const PUSH_TIP =
  'Warm the joint up with a lighter set first, and keep the movement smooth — jerky reps shift stress to the joint instead of the muscle.';
const PULL_TIP =
  'Focus on pulling with your elbows rather than your hands, and avoid using body momentum to move the weight.';
const CORE_TIP =
  'Move slowly and keep your ribs stacked over your hips — speed usually means momentum is doing the work instead of your core.';
const GENERIC_TIP =
  'Prioritize full range of motion and a controlled tempo over adding weight — good form now means more progress later.';

function matchesAny(muscles: MuscleGroup[], bucket: MuscleGroup[]): boolean {
  return muscles.some((muscle) => bucket.includes(muscle));
}

export function trainingTip(name: string, primaryMuscles: MuscleGroup[]): string {
  const curated = CURATED_TIPS[name];
  if (curated) return curated;

  if (matchesAny(primaryMuscles, LEG_MUSCLES)) return LEG_TIP;
  if (matchesAny(primaryMuscles, PUSH_MUSCLES)) return PUSH_TIP;
  if (matchesAny(primaryMuscles, PULL_MUSCLES)) return PULL_TIP;
  if (matchesAny(primaryMuscles, CORE_MUSCLES)) return CORE_TIP;
  return GENERIC_TIP;
}
