import { Inject, Injectable } from '@nestjs/common';

import { Database, DRIZZLE } from '../database/database.module';
import { waitlistSignups } from '../database/schema/waitlist.schema';

/**
 * Stores waitlist sign-ups (ADR-051). One method, because the endpoint this backs has one
 * job: `on conflict (email) do nothing` means a new address and a repeat run the identical
 * query and neither can distinguish itself from the other by timing or by an error path,
 * which is what lets `WaitlistService` answer both the same way.
 */
@Injectable()
export class WaitlistRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async signUp(email: string): Promise<void> {
    await this.db.insert(waitlistSignups).values({ email }).onConflictDoNothing({
      target: waitlistSignups.email,
    });
  }
}
