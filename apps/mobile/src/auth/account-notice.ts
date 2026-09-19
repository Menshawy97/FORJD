/**
 * One-shot notices the welcome screen shows after the account has been removed underneath the
 * user (ADR-042). In memory only, and read-once: it answers "did an under-age sign-up just get
 * turned away?" exactly once, so an ordinary later visit to /welcome never shows it.
 *
 * Kept out of `secureStorage.ts` on purpose. That module already carries the session-expired
 * flag, and adding an export there means every test that mocks it has to learn about the new
 * function; a separate module needs no such change.
 */
let underage = false;

export function setUnderageNotice(): void {
  underage = true;
}

/** Read-once: returns whether an under-age sign-up was just turned away, and resets the flag. */
export function consumeUnderageNotice(): boolean {
  const was = underage;
  underage = false;
  return was;
}
