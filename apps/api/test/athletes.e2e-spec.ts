import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { profiles } from '../src/database/schema/profiles.schema';
import { users } from '../src/database/schema/users.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ownerEmail = `e2e-athlete-owner-${suiteId}@example.com`;
const viewerEmail = `e2e-athlete-viewer-${suiteId}@example.com`;

/**
 * The sharpest authorization surface in the slice, exercised end to end. The unit suite
 * (athletes.service.spec.ts, 100% threshold) covers every branch of the decision in
 * isolation; this suite proves the route, the guard and the two repositories are wired
 * together correctly and that a real HTTP response carries the property the decision exists
 * to guarantee.
 */
describe('Public athlete profile (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let ownerId: string;

  const get = (userId: string, token: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/athletes/${userId}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [
            {
              email: ownerEmail,
              externalId: '33333333-3333-4333-8333-333333333333',
              tokens: ['owner-token'],
            },
            {
              email: viewerEmail,
              externalId: '44444444-4444-4444-8444-444444444444',
              tokens: ['viewer-token'],
            },
          ],
          signIn: 'disabled',
        }),
      )
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    db = app.get<Database>(DRIZZLE);

    const owner = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: ownerEmail, password: 'Str0ngPass!', displayName: 'Ada Lovelace' })
      .expect(201);
    ownerId = owner.body.userId;

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: viewerEmail, password: 'Str0ngPass!' })
      .expect(201);
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [ownerEmail, viewerEmail]));
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get(`/api/v1/athletes/${ownerId}`).expect(401);
  });

  it('answers 404 for a private profile, not 403', async () => {
    // Registration leaves publicProfile false, per the opt-in default.
    await get(ownerId, 'viewer-token').expect(404);
  });

  /**
   * The property this endpoint exists to guarantee, over real HTTP. An attacker probing ids
   * must get the same status, same body shape and same message for "no such account" as for
   * "that account exists but is private".
   */
  it('is indistinguishable between an unknown user and a private one', async () => {
    const unknownId = '55555555-5555-4555-8555-555555555555';

    const unknown = await get(unknownId, 'viewer-token').expect(404);
    const priv4te = await get(ownerId, 'viewer-token').expect(404);

    expect(unknown.body).toEqual(priv4te.body);
  });

  it('answers 404 rather than 500 for a malformed id', async () => {
    await get('not-a-uuid', 'viewer-token').expect(404);
  });

  it('returns the public projection once the owner opts in', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', 'Bearer owner-token')
      .send({ trainingGoals: ['get_stronger'], activities: ['strength'] })
      .expect(200);

    // city is not writable over the wire until phase E — set it directly, the way phase E's
    // reverse-geocode handler eventually will, so this suite can still assert the *read* side
    // that already exists rather than waiting on a phase that has not landed.
    await db.update(profiles).set({ city: 'Cairo' }).where(eq(profiles.userId, ownerId));

    // No public-profile endpoint exists to opt in yet other than the settings screen's flag,
    // which phase C put on the wire — set it the same way a real client would.
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/privacy')
      .set('Authorization', 'Bearer owner-token')
      .send({ publicProfile: true })
      .expect(200);

    const response = await get(ownerId, 'viewer-token').expect(200);

    expect(response.body).toEqual({
      userId: ownerId,
      displayName: 'Ada Lovelace',
      username: null,
      avatarUrl: null,
      city: 'Cairo',
      trainingGoals: ['get_stronger'],
      activities: ['strength'],
      isSelf: false,
    });
  });

  it('never returns a private field, over the wire', async () => {
    const response = await get(ownerId, 'viewer-token').expect(200);

    for (const field of [
      'email',
      'dateOfBirth',
      'sex',
      'heightCm',
      'unitSystem',
      'weightUnit',
      'distanceUnit',
      'energyUnit',
      'citySlug',
      'plan',
    ]) {
      expect(response.body).not.toHaveProperty(field);
    }
  });

  it('shows a private profile to its own owner, marked isSelf', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/privacy')
      .set('Authorization', 'Bearer owner-token')
      .send({ publicProfile: false })
      .expect(200);

    const response = await get(ownerId, 'owner-token').expect(200);

    expect(response.body.isSelf).toBe(true);
    expect(response.body.displayName).toBe('Ada Lovelace');
  });
});
