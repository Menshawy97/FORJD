const SAFE_CODE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_DEPTH = 5;

/**
 * What a failure may say in a log (Phase 12F drain): the error's name plus the machine codes on it and its causes (a Postgres
 * code such as 42P01 or 28P01, a network code such as ETIMEDOUT). Never the message: a database error's message can carry the
 * query's parameters, the connection string or a push token.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < MAX_DEPTH && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && SAFE_CODE.test(code)) codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes.length > 0 ? `${error.name}, code ${codes.join(' then ')}` : error.name;
}
