import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@forjd/domain';
import { notificationPreferencesResponseSchema } from '@forjd/contracts';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { users } from '../src/database/schema/users.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';
import { markAdult } from './support/adult';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailA = `e2e-notif-a-${suiteId}@example.com`;
const emailB = `e2e-notif-b-${suiteId}@example.com`;
const tokenA = 'notif-token-a';
const tokenB = 'notif-token-b';

/**
 * `GET`/`PATCH /api/v1/users/me/notifications` over real HTTP and real Postgres (Phase 12D). The
 * rules are unit-tested in the service spec; this suite shows what a unit test cannot: that the
 * guard runs first, the Zod pipe is attached, the response matches the contract, and one account
 * can neither read nor change another's switches (CLAUDE.md rule 12).
 */
describe('Notification preferences (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  const get = (token: string) =>
    request(app.getHttpServer()).get('/api/v1/users/me/notifications').set('Authorization', `Bearer ${token}`);
  const patch = (token: string, body: object) =>
    request(app.getHttpServer())
      .patch('/api/v1/users/me/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            { email: emailA, externalId: '11111111-2222-3333-4444-aaaaaaaaaaaa', tokens: [tokenA] },
            { email: emailB, externalId: '11111111-2222-3333-4444-bbbbbbbbbbbb', tokens: [tokenB] },
          ],
          refresh: { targetEmail: emailA },
        }),
      )
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    db = app.get<Database>(DRIZZLE);

    for (const email of [emailA, emailB]) {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password: 'Str0ngPass!' }).expect(201);
      await markAdult(app, email);
    }
  });

  afterAll(async () => {
    // notification_preferences cleans up via ON DELETE cascade.
    await db.delete(users).where(inArray(users.email, [emailA, emailB]));
    await app.close();
  });

  it('requires authentication on both routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me/notifications').expect(401);
    await request(app.getHttpServer()).patch('/api/v1/users/me/notifications').send({ rank: true }).expect(401);
  });

  it('answers the defaults with a null timestamp before anything is saved', async () => {
    const response = await get(tokenA).expect(200);

    expect(notificationPreferencesResponseSchema.parse(response.body)).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      updatedAt: null,
    });
  });

  it('saves one switch and answers the whole row, matching the contract', async () => {
    const response = await patch(tokenA, { rank: true }).expect(200);

    const body = notificationPreferencesResponseSchema.parse(response.body);
    expect(body).toMatchObject({ ...DEFAULT_NOTIFICATION_PREFERENCES, rank: true });
    expect(body.updatedAt).not.toBeNull();
    expect((await get(tokenA).expect(200)).body.rank).toBe(true);
  });

  it("keeps earlier switches when a later change sends a different one", async () => {
    await patch(tokenA, { workout: false }).expect(200);
    await patch(tokenA, { weekly: false }).expect(200);

    const body = (await get(tokenA).expect(200)).body;
    expect(body).toMatchObject({ workout: false, weekly: false, rank: true });
  });

  it("never shows or changes another account's switches", async () => {
    // A's saved changes above must not appear for B, and B's change must not reach A.
    expect((await get(tokenB).expect(200)).body).toMatchObject({ ...DEFAULT_NOTIFICATION_PREFERENCES, updatedAt: null });

    await patch(tokenB, { pr: false }).expect(200);

    expect((await get(tokenA).expect(200)).body.pr).toBe(true);
    expect((await get(tokenB).expect(200)).body.pr).toBe(false);
  });

  it('refuses an empty body, an unknown switch and a non-boolean with 400', async () => {
    await patch(tokenA, {}).expect(400);
    await patch(tokenA, { quietHours: '22:00' }).expect(400);
    await patch(tokenA, { rank: 'yes' }).expect(400);
  });
});
