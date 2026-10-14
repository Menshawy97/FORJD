import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { notificationListResponseSchema } from '@forjd/contracts';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { pushOutbox } from '../src/database/schema/push-outbox.schema';
import { users } from '../src/database/schema/users.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';
import { markAdult } from './support/adult';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailA = `e2e-feed-a-${suiteId}@example.com`;
const emailB = `e2e-feed-b-${suiteId}@example.com`;
const tokenA = 'feed-token-a';
const tokenB = 'feed-token-b';

/**
 * `GET /api/v1/users/me/notifications` over real HTTP and real Postgres (walk finding 17, slice B of
 * docs/product/notifications-list-and-profile-counts-plan.md). The rules are unit-tested; this shows the guard runs, the
 * answer matches the contract, and one account never sees another's pushes (CLAUDE.md rule 12).
 */
describe('Notifications list (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  const get = (token: string) =>
    request(app.getHttpServer()).get('/api/v1/users/me/notifications').set('Authorization', `Bearer ${token}`);
  const idOf = async (email: string): Promise<string> => {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return row!.id;
  };
  const sent = (userId: string, title: string, sentAt: Date, status = 'sent') => ({
    userId,
    kind: 'pr',
    dedupeKey: `feed:${suiteId}:${title}`,
    title,
    body: 'Open FORJD to see it.',
    data: { type: 'pr', sessionId: '0c6f2c8e-1b1a-4c55-9d7e-3a9f8d2b7c11' },
    occurredAt: sentAt,
    sendAfter: sentAt,
    status,
    sentAt: status === 'sent' ? sentAt : null,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            { email: emailA, externalId: '11111111-2222-3333-4444-eeeeeeeeeeee', tokens: [tokenA] },
            { email: emailB, externalId: '11111111-2222-3333-4444-ffffffffffff', tokens: [tokenB] },
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
    const now = Date.now();
    const a = await idOf(emailA);
    const b = await idOf(emailB);
    await db.insert(pushOutbox).values([
      sent(a, 'A older', new Date(now - 2 * 86_400_000)),
      sent(a, 'A newer', new Date(now - 3_600_000)),
      sent(a, 'A pending', new Date(now - 3_600_000), 'pending'),
      sent(a, 'A too old', new Date(now - 40 * 86_400_000)),
      sent(b, 'B only', new Date(now - 3_600_000)),
    ]);
  });

  afterAll(async () => {
    // push_outbox rows go with the account (ON DELETE cascade).
    await db.delete(users).where(inArray(users.email, [emailA, emailB]));
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me/notifications').expect(401);
  });

  it("answers the caller's own sent pushes from the last 30 days, newest first, in the contract's shape", async () => {
    const response = await get(tokenA).expect(200);

    const body = notificationListResponseSchema.parse(response.body);
    expect(body.items.map((item) => item.title)).toEqual(['A newer', 'A older']);
    expect(body.items[0]).toMatchObject({ kind: 'pr', body: 'Open FORJD to see it.', data: { type: 'pr' } });
  });

  it("never shows one account another's pushes", async () => {
    const response = await get(tokenB).expect(200);

    expect(notificationListResponseSchema.parse(response.body).items.map((item) => item.title)).toEqual(['B only']);
  });
});
