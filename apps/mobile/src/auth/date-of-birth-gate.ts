/**
 * Whether the signed-in account still has to give a date of birth (ADR-042). In memory only:
 * the server is the source of truth and re-answers on every launch (a profile read) and on
 * any request it refuses with `date_of_birth_required`.
 *
 * A tiny external store rather than React state so that `apiClient`'s interceptor -- which
 * has no component to hold state -- can raise it, and the root layout's gate can react. The
 * shape (`subscribe` / `getSnapshot`) is exactly what `useSyncExternalStore` wants, the same
 * seam `secureStorage` uses for the session.
 */
type Listener = () => void;

let needed = false;
const listeners = new Set<Listener>();

function set(next: boolean): void {
  if (needed === next) {
    return;
  }
  needed = next;
  listeners.forEach((listener) => listener());
}

export function getDateOfBirthNeeded(): boolean {
  return needed;
}

/** The server (or a profile read) says no date of birth is on file. */
export function requireDateOfBirth(): void {
  set(true);
}

/** The date has been accepted by the server. */
export function dateOfBirthProvided(): void {
  set(false);
}

/** Sign-out: the next account must not inherit this one's state. */
export function resetDateOfBirthGate(): void {
  set(false);
}

export function subscribeToDateOfBirthGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
