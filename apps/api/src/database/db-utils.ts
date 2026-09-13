import { SQL } from "drizzle-orm";
import { ZodType } from "zod";

import { Database } from "./database.module";

/**
 * Thrown by `executeValidated` when a raw SQL row fails its Zod schema -- a renamed or
 * retyped column produces a loud, named failure here instead of silently yielding `undefined`
 * into a caller's arithmetic.
 */
export class RawSqlValidationError extends Error {
  constructor(context: string, rowIndex: number, issues: string) {
    super(`executeValidated: "${context}" row ${rowIndex} failed validation: ${issues}`);
    this.name = "RawSqlValidationError";
  }
}

/**
 * Runs a raw SQL query and parses every returned row through `schema`, throwing a
 * `RawSqlValidationError` naming the offending row and column on the first mismatch rather
 * than letting a silently-renamed or retyped column flow as `undefined` into a caller's
 * arithmetic.
 *
 * `context` should identify the call site (e.g. the repository method name) so a validation
 * failure in production logs points straight at the query that produced it.
 */
export async function executeValidated<T>(
  db: Database,
  query: SQL,
  schema: ZodType<T>,
  context: string,
): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows.map((row, index) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(row)"}: ${issue.message}`)
        .join("; ");
      throw new RawSqlValidationError(context, index, issues);
    }
    return parsed.data;
  });
}
