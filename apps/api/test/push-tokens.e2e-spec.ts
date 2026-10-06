import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { devicePushTokens } from '../src/database/schema/device-push-tokens.schema';
import { users } from '../src/database/schema/users.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';
import { markAdult } from './support/adult';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emailA = `e2e-push-a-${suiteId}@example.com`;
const emailB = `e2e-push-b-${suiteId}@example.com`;
const tokenA = 'push-token-a';
const tokenB = 'push-token-b';
const phoneToken = `ExponentPushToken[e2e-${suiteId}]`;

/**
 * `POST`/`DELETE /api/v1/users/me/push-tokens` over real HTTP and real Postgres (Phase 12F). The rules are
 * unit-tested; this shows what a unit test cannot: that the guard runs first, the Zod pipe is attached, the answer is
 * 204, and one account can neither read nor remove another's token (CLAUDE.md rule 12).
 */
describe('Push tokens (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  const post = (token: string, body: object) =>
    request(app.getHttpServer()).post('/api/v1/users/me/push-tokens').set('Authorization', `Bearer ${token}`).send(body);
  const del = (token: string, body: object) =>
    request(app.getHttpServer()).delete('/api/v1/users/me/push-tokens').set('Authorization', `Bearer ${token}`).send(body);
  const stored = async (value: string) =>
    db.select().from(devicePushTokens).where(eq(devicePushTokens.token, value));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            { email: emailA, externalId: '11111111-2222-3333-4444-cccccccccccc', tokens: [tokenA] },
            { email: emailB, externalId: '11111111-2222-3333-4444-dddddddddddd', tokens: [tokenB] },
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
    // device_push_tokens cleans up via ON DELETE cascade.
    await db.delete(users).where(inArray(users.email, [emailA, emailB]));
    await app.close();
  });

  it('requires authentication on both routes', async () => {
    await request(app.getHttpServer()).post('/api/v1/users/me/push-tokens').send({ token: phoneToken, platform: 'android' }).expect(401);
    await request(app.getHttpServer()).delete('/api/v1/users/me/push-tokens').send({ token: phoneToken }).expect(401);
  });

  it('registers a token with 204, and registering it again is fine', async () => {
    await post(tokenA, { token: phoneToken, platform: 'android' }).expect(204);
    await post(tokenA, { token: phoneToken, platform: 'android' }).expect(204);

    expect(await stored(phoneToken)).toHaveLength(1);
  });

  it("moves the token to whoever registers it next, so the first account stops receiving pushes on that phone", async () => {
    await post(tokenB, { token: phoneToken, platform: 'android' }).expect(204);

    const rows = await stored(phoneToken);
    expect(rows).toHaveLength(1);
    const [owner] = await db.select().from(users).where(eq(users.email, emailB));
    expect(rows[0]!.userId).toBe(owner!.id);
  });

  it("does not remove another account's token, and says nothing about whether it exists", async () => {
    await del(tokenA, { token: phoneToken }).expect(204);

    expect(await stored(phoneToken)).toHaveLength(1);
  });

  it("removes the caller's own token with 204, and removing it twice is fine", async () => {
    await del(tokenB, { token: phoneToken }).expect(204);
    await del(tokenB, { token: phoneToken }).expect(204);

    expect(await stored(phoneToken)).toHaveLength(0);
  });

  it('refuses a bad body with 400: an empty token, whitespace, an unknown platform, an extra key', async () => {
    await post(tokenA, { token: '', platform: 'android' }).expect(400);
    await post(tokenA, { token: 'has space', platform: 'android' }).expect(400);
    await post(tokenA, { token: phoneToken, platform: 'web' }).expect(400);
    await post(tokenA, { token: phoneToken, platform: 'ios', userId: 'x' }).expect(400);
    await del(tokenA, {}).expect(400);
  });
});
