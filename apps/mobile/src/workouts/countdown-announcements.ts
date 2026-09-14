/**
 * R18 (H12): a repository-wide grep found zero `accessibilityLiveRegion` and zero
 * `announceForAccessibility` -- the rest and timed-set countdowns were entirely silent to a
 * screen reader. A blind athlete got no countdown and no "time's up".
 *
 * `announceForAccessibility` must not fire on every 250ms tick -- that would talk over itself
 * and drown out everything else on screen. It fires on a coarse schedule instead: every fifth
 * second while there is still time to spare, then every single second once it matters (the
 * last ten seconds), matching how a human coach counts down out loud.
 */
export function shouldAnnounceCountdownSecond(remainingSeconds: number): boolean {
  if (remainingSeconds <= 0) return false;
  if (remainingSeconds <= 10) return true;
  return remainingSeconds % 5 === 0;
}
