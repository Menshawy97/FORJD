import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { AppModule } from '../src/app.module';
import { waitlistSignups } from '../src/database/schema/waitlist.schema';
import { TURNSTILE_CLIENT } from '../src/integrations/turnstile/turnstile-client';
import { FakeTurnstileClient } from './support/fake-turnstile-client';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `e2e-waitlist-${suiteId}@example.com`;

/**
 * `POST /api/v1/waitlist` over real HTTP with the real throttler (ADR-051, W3b, plan step 7).
 *
 * The limit is 5 calls per 10 minutes, and it counts every call, including ones a body check
 * later refuses (guards run before pipes) -- the same shape `auth-resend-confirmation.e2e-spec.ts`
 * uses. Four of the plan's five scenarios (accepted, duplicate, bad email, bad token) spend
 * calls 1-4 of that budget; the fifth test sends the 5th call (still inside the budget, so it
 * must still succeed) immediately followed by a 6th, which is the one the throttler turns away.
 */
describe('Waitlist sign-up (e2e)', () => {
  let app: INestApplication;
  let turnstile: FakeTurnstileClient;
  let pool: Pool;
  let db: NodePgDatabase<Record<string, never>>;

  beforeAll(async () => {
    turnstile = new FakeTurnstileClient(new Set(['rejected-token']));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TURNSTILE_CLIENT)
      .useValue(turnstile)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://forjd:forjd_local_dev@localhost:5432/forjd',
    });
    db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
  });

  afterAll(async () => {
    await db.delete(waitlistSignups).where(inArray(waitlistSignups.email, [email]));
    await pool.end();
    await app.close();
  });

  it('accepts a new address with 202 and an accepted status', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/waitlist')
      .send({ email, turnstileToken: 'good-token' })
      .expect(202);

    expect(response.body).toEqual({ status: 'accepted' });
  });

  it('answers a repeat sign-up exactly the same, without a second row', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/waitlist')
      .send({ email, turnstileToken: 'good-token' })
      .expect(202);

    expect(response.body).toEqual({ status: 'accepted' });

    const rows = await db
      .select()
      .from(waitlistSignups)
      .where(inArray(waitlistSignups.email, [email]));
    expect(rows).toHaveLength(1);
  });

  it('rejects a malformed address with 400, before reaching Turnstile', async () => {
    const before = turnstile.verifiedTokens.length;

    await request(app.getHttpServer())
      .post('/api/v1/waitlist')
      .send({ email: 'not-an-email', turnstileToken: 'good-token' })
      .expect(400);

    expect(turnstile.verifiedTokens).toHaveLength(before);
  });

  it('refuses a request Turnstile rejects with 400, and stores nothing', async () => {
    const other = `e2e-waitlist-rejected-${suiteId}@example.com`;

    await request(app.getHttpServer())
      .post('/api/v1/waitlist')
      .send({ email: other, turnstileToken: 'rejected-token' })
      .expect(400);

    const rows = await db
      .select()
      .from(waitlistSignups)
      .where(inArray(waitlistSignups.email, [other]));
    expect(rows).toHaveLength(0);
  });

  it('lets the fifth call through, then turns away the sixth', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/waitlist')
      .send({ email, turnstileToken: 'good-token' })
      .expect(202);

    await request(app.getHttpServer())
      .post('/api/v1/waitlist')
      .send({ email, turnstileToken: 'good-token' })
      .expect(429);
  });
});
