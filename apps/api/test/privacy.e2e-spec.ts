import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { users } from '../src/database/schema/users.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testEmail = `e2e-privacy-${suiteId}@example.com`;
const externalId = '99999999-8888-7777-6666-555555555555';
const accessToken = 'privacy-access-token';

/**
 * Proves the privacy route is actually reachable and that the consent invariants surface as
 * real HTTP status codes.
 *
 * The rules themselves are unit-tested in privacy.service.spec.ts (which carries a 100%
 * threshold); this suite exists for what a unit test cannot show — that the controller is
 * wired, the Zod pipe is attached, the guard runs first, and a BadRequestException from the
 * service becomes a 400 rather than a 500. E2E does **not** count toward the coverage gate,
 * so nothing here is standing in for a unit test.
 */
describe('Privacy settings (e2e)', () => {
  let app: INestApplication;
  let db: Database;

  const patchPrivacy = () =>
    request(app.getHttpServer()).patch('/api/v1/users/me/privacy');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [{ email: testEmail, externalId, tokens: [accessToken] }],
          refresh: { targetEmail: testEmail },
        }),
      )
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    db = app.get<Database>(DRIZZLE);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: testEmail, password: 'Str0ngPass!' })
      .expect(201);
  });

  afterAll(async () => {
    // privacy_settings and profiles clean up via ON DELETE cascade.
    await db.delete(users).where(inArray(users.email, [testEmail]));
    await app.close();
  });

  it('requires authentication', async () => {
    await patchPrivacy().send({ publicProfile: true }).expect(401);
  });

  /** A brand-new account must read as all-off, which is what opt-in means. */
  it('starts every flag off', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.privacy).toEqual({
      publicProfile: false,
      leaderboardOptIn: false,
      locationForLeaderboard: false,
      aiFeaturesConsent: false,
      aiFeaturesConsentAt: null,
      crashDiagnostics: false,
    });
  });

  it('persists a change and reflects it on the next read', async () => {
    await patchPrivacy()
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ publicProfile: true })
      .expect(200);

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.privacy.publicProfile).toBe(true);
  });

  /**
   * The invariant, as the client actually experiences it. A 500 here would mean the rule had
   * been left to the database instead of the service.
   */
  it('answers 400, not 500, when location is enabled without the leaderboard', async () => {
    const response = await patchPrivacy()
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ locationForLeaderboard: true })
      .expect(400);

    expect(JSON.stringify(response.body)).toMatch(/leaderboardOptIn/);
  });

  it('accepts location once the leaderboard is on, and cascades it off again', async () => {
    await patchPrivacy()
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ leaderboardOptIn: true, locationForLeaderboard: true })
      .expect(200);

    const response = await patchPrivacy()
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ leaderboardOptIn: false })
      .expect(200);

    // The cascade, over the wire: dropping the parent takes the child with it.
    expect(response.body.leaderboardOptIn).toBe(false);
    expect(response.body.locationForLeaderboard).toBe(false);
  });

  it('rejects a non-boolean flag', async () => {
    await patchPrivacy()
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ publicProfile: 'yes' })
      .expect(400);
  });

  it('rejects an empty body', async () => {
    await patchPrivacy().set('Authorization', `Bearer ${accessToken}`).send({}).expect(400);
  });

  /**
   * A client cannot claim a consent date. The field is absent from the request schema, so it
   * is stripped and the timestamp remains whatever the real transition produced.
   */
  it('ignores a client-supplied consent timestamp', async () => {
    const response = await patchPrivacy()
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ aiFeaturesConsent: true, aiFeaturesConsentAt: '1999-01-01T00:00:00.000Z' })
      .expect(200);

    expect(response.body.aiFeaturesConsent).toBe(true);
    expect(response.body.aiFeaturesConsentAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(new Date(response.body.aiFeaturesConsentAt).getFullYear()).toBeGreaterThan(2020);
  });
});
