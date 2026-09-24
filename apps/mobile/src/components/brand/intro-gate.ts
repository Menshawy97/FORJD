/**
 * Whether the #9 intro (ADR-052) still has to play in this process. It plays once per cold
 * start: module scope survives the root layout re-mounting (fast refresh, a sign-out) but not
 * the app being killed, which is exactly "every time the app opens" without replaying when it
 * merely returns from the background.
 */
let introShown = false;

export function shouldShowIntro(): boolean {
  return !introShown;
}

export function markIntroShown(): void {
  introShown = true;
}

/** Test-only: the route-tree tests' setup marks the intro shown; its own tests undo that. */
export function resetIntroForTests(): void {
  introShown = false;
}
