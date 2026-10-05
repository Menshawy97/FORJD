import type { ErrorEvent, Exception, StackFrame } from '@sentry/nestjs';

/**
 * What every exception message becomes. The type and the stack frames survive; the words do not.
 */
export const REDACTED = '[redacted]';

/**
 * Top-level fields copied as they are: identifiers, the SDK's own metadata and where the code
 * ran. `user` is here because it is decided separately, by consent (`createCrashReportFilter`).
 * `transaction` is the route template (`GET /api/v1/nutrition/foods/:id`), never the filled-in
 * URL. Anything not listed — message, logentry, request, breadcrumbs, extra, tags, and any field
 * a future SDK adds — is dropped, so the list fails closed.
 */
const KEPT_FIELDS = [
  'type',
  'event_id',
  'timestamp',
  'level',
  'platform',
  'environment',
  'release',
  'dist',
  'server_name',
  'transaction',
  'sdk',
  'modules',
  'debug_meta',
  'user',
] as const;

/** Contexts that describe the machine and the trace, never the person or the request. */
const KEPT_CONTEXTS = ['trace', 'runtime', 'os'] as const;

/** Reads a user's crash-diagnostics choice. Resolves `true` only for an explicit opt-in. */
export type CrashConsentLookup = (userId: string) => Promise<boolean>;

/**
 * Removes every piece of free text from a server crash report, whatever anyone consented to.
 *
 * **Why all of it, not just the health-looking parts** (owner decision, 2026-10-01,
 * `docs/product/engineering-gaps-plan.md`): an exception message, a request body or a
 * breadcrumb can carry a weight, a heart rate or a meal, and a pattern that tries to spot them
 * will one day miss one. CLAUDE.md rule 15 says health data never reaches a third-party SDK,
 * so this is shaped like that rule: an allowlist of what is kept — the error's type, its
 * mechanism type, and each frame's file, function, line and column — with everything else
 * gone. Source lines are dropped too, because a line of code can embed a literal.
 *
 * Returns a new event; the one passed in is not changed.
 */
export function stripCrashReportText(event: ErrorEvent): ErrorEvent {
  const kept = Object.fromEntries(
    Object.entries(event).filter(([key]) => (KEPT_FIELDS as readonly string[]).includes(key)),
  ) as ErrorEvent;
  const { contexts, exception } = event;

  return {
    ...kept,
    ...(exception ? { exception: { values: exception.values?.map(stripException) } } : {}),
    ...(contexts ? { contexts: keepContexts(contexts) } : {}),
  };
}

function stripException(exception: Exception): Exception {
  const frames = exception.stacktrace?.frames;

  return {
    ...(exception.type !== undefined ? { type: exception.type } : {}),
    value: REDACTED,
    ...(exception.mechanism
      ? { mechanism: { type: exception.mechanism.type, handled: exception.mechanism.handled } }
      : {}),
    ...(frames ? { stacktrace: { frames: frames.map(stripFrame) } } : {}),
  };
}

function stripFrame({ filename, function: fn, lineno, colno, in_app }: StackFrame): StackFrame {
  return { filename, function: fn, lineno, colno, in_app };
}

function keepContexts(contexts: NonNullable<ErrorEvent['contexts']>): NonNullable<ErrorEvent['contexts']> {
  return Object.fromEntries(KEPT_CONTEXTS.filter((key) => contexts[key]).map((key) => [key, contexts[key]]));
}

/**
 * Builds Sentry's `beforeSend`: strips the text, then applies the crash-diagnostics choice of
 * the person whose request crashed.
 *
 * - **No user on the event** (server start-up, an unauthenticated request, a background job):
 *   sent, with no user. There is no person whose choice it would override.
 * - **A user who turned crash diagnostics off: not sent at all** (owner decision, 2026-10-01;
 *   what `data-inventory.md` promises).
 * - **A user who turned it on:** sent with their id and nothing else about them.
 * - **A user whose choice cannot be read** — no lookup registered yet, or the read failed, which
 *   is common because the database is often what broke: **not sent**. It fails closed; a choice
 *   that cannot be read is treated as "off", never as "on".
 *
 * The lookup is read lazily through `currentLookup` because Sentry is initialised before Nest
 * builds the service that can answer it (`instrument.ts` must run first).
 */
export function createCrashReportFilter(
  currentLookup: () => CrashConsentLookup | null,
): (event: ErrorEvent) => Promise<ErrorEvent | null> {
  return async (event) => {
    const { user, ...stripped } = stripCrashReportText(event);
    const userId = user?.id === undefined || user.id === null ? null : String(user.id);
    if (userId === null) {
      return stripped;
    }

    const lookup = currentLookup();
    if (!lookup) {
      return null;
    }

    try {
      return (await lookup(userId)) ? { ...stripped, user: { id: userId } } : null;
    } catch {
      return null;
    }
  };
}
