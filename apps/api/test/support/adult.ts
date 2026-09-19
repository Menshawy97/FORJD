import { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { Database, DRIZZLE } from "../../src/database/database.module";
import { privacySettings } from "../../src/database/schema/privacy-settings.schema";
import { profiles } from "../../src/database/schema/profiles.schema";
import { users } from "../../src/database/schema/users.schema";

/**
 * ADR-042 -- `JwtAuthGuard` refuses every route (bar a handful) for an account with no date of
 * birth on file. Suites that register a throwaway user only to exercise some other feature call
 * this straight after `POST /auth/register`, so they keep testing that feature rather than the
 * age gate. The age gate itself is covered by `users-age-gate.e2e-spec.ts`, which does not use
 * this helper.
 */
export async function markAdult(app: INestApplication, email: string): Promise<void> {
  const db = app.get<Database>(DRIZZLE);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    throw new Error(`markAdult: no user registered for ${email}`);
  }
  await db.update(profiles).set({ dateOfBirth: "1990-01-01" }).where(eq(profiles.userId, user.id));
}

/**
 * ADR-043 -- health data is collected only after the person has given health-data consent.
 * Suites that exercise health ingestion or WHOOP call this after registering, the same way
 * `markAdult` gets past the age gate; the consent gate itself is covered by
 * `health-consent.e2e-spec.ts`.
 */
export async function grantHealthConsent(app: INestApplication, email: string): Promise<void> {
  const db = app.get<Database>(DRIZZLE);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    throw new Error(`grantHealthConsent: no user registered for ${email}`);
  }
  await db
    .update(privacySettings)
    .set({ healthDataConsent: true, healthDataConsentAt: new Date() })
    .where(eq(privacySettings.userId, user.id));
}
