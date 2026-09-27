import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { Database, DRIZZLE } from '../database/database.module';
import { featureFlags } from '../database/schema/feature-flags.schema';

/** The flag Weekly Forge ships behind, switched off by migration 0030 (ADR-057 decision 11). */
export const WEEKLY_FORGE_FLAG = 'weekly_forge';

/**
 * Reads `feature_flags`, the one switch that turns a feature on without a deploy. A flag with no
 * row is off: a feature can never be switched on by a missing row.
 */
@Injectable()
export class FeatureFlagsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async isEnabled(key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ key: featureFlags.key })
      .from(featureFlags)
      .where(and(eq(featureFlags.key, key), eq(featureFlags.enabled, true)));
    return row !== undefined;
  }

  async enabledKeys(): Promise<string[]> {
    const rows = await this.db.select({ key: featureFlags.key }).from(featureFlags).where(eq(featureFlags.enabled, true));
    return rows.map((row) => row.key).sort();
  }
}
