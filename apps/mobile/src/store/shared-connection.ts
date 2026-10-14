/**
 * One database connection per file, opened once and held for the life of the app.
 *
 * Why (docs/reviews/2026-10-14-emulator-walk.md, finding 2): expo-sqlite gives every open of the same
 * file the same native connection, and when any one JavaScript handle to it is garbage collected it
 * closes that connection for everyone (`NativeDatabase.sharedObjectDidRelease` calls `close()` without
 * looking at its reference count). The stores used to open a fresh handle per call and drop it, so a
 * collection could close the database under a live workout or run, and every later call failed with
 * `NativeDatabase.prepareAsync ... NullPointerException`. A handle this module keeps is never collected.
 *
 * A failed open is not kept, so the next call tries again. `release` closes the connection and
 * forgets it, which the account-deletion path needs before it removes the file.
 */
export interface SharedConnection<T> {
  get(): Promise<T>;
  release(): Promise<void>;
}

export function sharedConnection<T extends { closeAsync(): Promise<void> }>(
  open: () => Promise<T>,
): SharedConnection<T> {
  let pending: Promise<T> | null = null;
  // While a release is closing the connection, a new open would be handed the same native connection
  // mid-close (expo-sqlite reuses it by path), so `get` waits for the close to finish first.
  let releasing: Promise<void> | null = null;

  const get = (): Promise<T> => {
    if (releasing !== null) return releasing.then(get);
    if (pending === null) {
      const attempt = open();
      pending = attempt;
      attempt.catch(() => {
        if (pending === attempt) pending = null;
      });
    }
    return pending;
  };

  return {
    get,
    async release() {
      const current = pending;
      pending = null;
      if (current === null) return;
      const closing = (async () => {
        try {
          await (await current).closeAsync();
        } catch {
          // Never opened, or already closed: either way there is nothing left to close.
        }
      })();
      releasing = closing;
      await closing;
      if (releasing === closing) releasing = null;
    },
  };
}
