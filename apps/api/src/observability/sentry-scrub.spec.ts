import type { ErrorEvent } from '@sentry/nestjs';

import { createCrashReportFilter, REDACTED, stripCrashReportText } from './sentry-scrub';

/**
 * A server crash report as Sentry's Node SDK can build it: the exception message, the request
 * that was being served, breadcrumbs, and free-form context. Every string in it that could hold
 * a health value carries one, so a test can assert none of them survives.
 */
const HEALTH_TEXT = 'weight 82.4 kg, resting heart rate 51 bpm';

const fullEvent = (over: Partial<ErrorEvent> = {}): ErrorEvent =>
  ({
    event_id: 'e1',
    message: HEALTH_TEXT,
    logentry: { message: HEALTH_TEXT, params: [HEALTH_TEXT] },
    exception: {
      values: [
        {
          type: 'BadRequestException',
          value: HEALTH_TEXT,
          mechanism: { type: 'generic', handled: false, data: { detail: HEALTH_TEXT } },
          stacktrace: {
            frames: [
              {
                filename: 'app:///dist/nutrition/nutrition.service.js',
                function: 'NutritionService.logFood',
                lineno: 120,
                colno: 7,
                in_app: true,
                context_line: `const note = "${HEALTH_TEXT}";`,
                pre_context: [HEALTH_TEXT],
                post_context: [HEALTH_TEXT],
                vars: { body: HEALTH_TEXT },
              },
            ],
          },
        },
      ],
    },
    request: { url: `/api/v1/x?q=${HEALTH_TEXT}`, data: HEALTH_TEXT, query_string: HEALTH_TEXT, headers: { a: HEALTH_TEXT } },
    breadcrumbs: [{ message: HEALTH_TEXT, data: { body: HEALTH_TEXT } }],
    extra: { body: HEALTH_TEXT },
    tags: { note: HEALTH_TEXT },
    contexts: {
      trace: { trace_id: 't1', span_id: 's1' },
      runtime: { name: 'node', version: 'v22' },
      os: { name: 'linux' },
      state: { body: HEALTH_TEXT },
    },
    user: { id: 'user-1', email: 'ada@example.com', ip_address: '10.0.0.1' },
    ...over,
  }) as ErrorEvent;

describe('stripCrashReportText', () => {
  it('leaves no trace of the health text anywhere in the report', () => {
    const stripped = stripCrashReportText(fullEvent());

    expect(JSON.stringify(stripped)).not.toContain('82.4');
    expect(JSON.stringify(stripped)).not.toContain('bpm');
  });

  it('keeps the error type and where it happened, which is what fixing it needs', () => {
    const stripped = stripCrashReportText(fullEvent());
    const exception = stripped.exception?.values?.[0];
    const frame = exception?.stacktrace?.frames?.[0];

    expect(exception?.type).toBe('BadRequestException');
    expect(exception?.value).toBe(REDACTED);
    expect(exception?.mechanism).toEqual({ type: 'generic', handled: false });
    expect(frame).toEqual({
      filename: 'app:///dist/nutrition/nutrition.service.js',
      function: 'NutritionService.logFood',
      lineno: 120,
      colno: 7,
      in_app: true,
    });
  });

  it('keeps only the trace, runtime and os contexts', () => {
    const stripped = stripCrashReportText(fullEvent());

    expect(Object.keys(stripped.contexts ?? {}).sort()).toEqual(['os', 'runtime', 'trace']);
  });

  it('does not touch the user, which is a consent decision rather than a text one', () => {
    const stripped = stripCrashReportText(fullEvent());

    expect(stripped.user).toEqual({ id: 'user-1', email: 'ada@example.com', ip_address: '10.0.0.1' });
  });

  it('copes with an event that has no exception at all', () => {
    const stripped = stripCrashReportText(fullEvent({ exception: undefined }));

    expect(stripped.exception).toBeUndefined();
    expect(stripped.message).toBeUndefined();
  });

  it('does not mutate the event it was given', () => {
    const original = fullEvent();
    const snapshot = JSON.stringify(original);

    stripCrashReportText(original);

    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('createCrashReportFilter', () => {
  const filterWith = (lookup: ((userId: string) => Promise<boolean>) | null) =>
    createCrashReportFilter(() => lookup);

  it('sends a crash tied to no user, with no user and no text', async () => {
    const sent = await filterWith(null)(fullEvent({ user: undefined }));

    expect(sent).not.toBeNull();
    expect(sent?.user).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain('82.4');
  });

  it('drops the crash entirely when that user turned crash diagnostics off', async () => {
    const lookup = jest.fn().mockResolvedValue(false);

    const sent = await filterWith(lookup)(fullEvent());

    expect(sent).toBeNull();
    expect(lookup).toHaveBeenCalledWith('user-1');
  });

  it('keeps only the user id, and no text, when that user turned crash diagnostics on', async () => {
    const sent = await filterWith(jest.fn().mockResolvedValue(true))(fullEvent());

    expect(sent?.user).toEqual({ id: 'user-1' });
    expect(JSON.stringify(sent)).not.toContain('82.4');
    expect(JSON.stringify(sent)).not.toContain('ada@example.com');
  });

  /**
   * Fails closed. There is a person behind this crash and their choice cannot be read (the
   * database is often the very thing that failed), so it is not sent rather than sent against
   * a choice that may be "off".
   */
  it('drops the crash when the user is known but their setting cannot be read', async () => {
    const sent = await filterWith(jest.fn().mockRejectedValue(new Error('db down')))(fullEvent());

    expect(sent).toBeNull();
  });

  it('drops a crash with a user when no lookup has been registered yet', async () => {
    const sent = await filterWith(null)(fullEvent());

    expect(sent).toBeNull();
  });

  it('treats a user without an id as no user', async () => {
    const lookup = jest.fn();

    const sent = await filterWith(lookup)(fullEvent({ user: { email: 'ada@example.com' } }));

    expect(lookup).not.toHaveBeenCalled();
    expect(sent?.user).toBeUndefined();
  });
});
