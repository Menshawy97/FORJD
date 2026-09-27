import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  featureFlagsResponseSchema,
  forgePendingWeeksResponseSchema,
  forgeResponseSchema,
  publicProfileResponseSchema,
} from '@forjd/contracts';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { AUTH_PROVIDER } from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { featureFlags } from '../src/database/schema/feature-flags.schema';
import { forgeUserLadders, forgeWeeks } from '../src/database/schema/forge.schema';
import { preferences } from '../src/database/schema/preferences.schema';
import { users } from '../src/database/schema/users.schema';
import { FakeAuthProvider } from './support/fake-auth-provider';
import { markAdult } from './support/adult';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const OWNER = { email: `e2e-forge-owner-${suiteId}@example.com`, token: 'forge-owner-token', externalId: randomUUID() };
const VIEWER = { email: `e2e-forge-viewer-${suiteId}@example.com`, token: 'forge-viewer-token', externalId: randomUUID() };

/**
 * Weekly Forge over real HTTP (ADR-057): the flag gate, enrolment on first read, the time-zone
 * write, the pending week summaries and their acknowledgement, and the public profile's Forge
 * block (public ladders only). Every response is parsed against the published contract.
 */
describe('Weekly Forge (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let ownerId: string;

  const as = (account: { token: string }) => ({ Authorization: `Bearer ${account.token}` });
  const setFlag = (enabled: boolean) =>
    db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'weekly_forge'));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(
        new FakeAuthProvider({
          accounts: [OWNER, VIEWER].map((a) => ({ email: a.email, externalId: a.externalId, tokens: [a.token] })),
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

    for (const account of [OWNER, VIEWER]) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: account.email, password: 'Str0ngPass!' })
        .expect(201);
      await markAdult(app, account.email);
    }
    const [owner] = await db.select().from(users).where(eq(users.email, OWNER.email));
    ownerId = owner!.id;
    await request(app.getHttpServer())
      .patch('/api/v1/users/me/privacy')
      .set(as(OWNER))
      .send({ publicProfile: true })
      .expect(200);
  });

  afterAll(async () => {
    await setFlag(false);
    await db.delete(users).where(inArray(users.email, [OWNER.email, VIEWER.email]));
    await app.close();
  });

  describe('while weekly_forge is off', () => {
    beforeAll(async () => {
      await setFlag(false);
    });

    it('answers 404 on every Forge route and enrols nobody', async () => {
      await request(app.getHttpServer()).get('/api/v1/forge').set(as(OWNER)).expect(404);
      await request(app.getHttpServer()).get('/api/v1/forge/weeks/pending').set(as(OWNER)).expect(404);
      await request(app.getHttpServer()).post('/api/v1/forge/weeks/2026-09-19/ack').set(as(OWNER)).expect(404);

      expect(await db.select().from(forgeUserLadders).where(eq(forgeUserLadders.userId, ownerId))).toEqual([]);
    });

    it('lists no weekly_forge in the enabled flags', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/feature-flags').set(as(OWNER)).expect(200);

      expect(featureFlagsResponseSchema.parse(response.body).enabled).not.toContain('weekly_forge');
    });

    it('shows no Forge block on the public profile', async () => {
      const response = await request(app.getHttpServer()).get(`/api/v1/athletes/${ownerId}`).set(as(VIEWER)).expect(200);

      expect(publicProfileResponseSchema.parse(response.body).forge).toBeNull();
    });
  });

  it('stores the phone time zone, and refuses one that is not an IANA zone', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/users/me/timezone')
      .set(as(OWNER))
      .send({ timeZone: 'Africa/Cairo' })
      .expect(204);
    await request(app.getHttpServer())
      .put('/api/v1/users/me/timezone')
      .set(as(OWNER))
      .send({ timeZone: 'Mars/Olympus' })
      .expect(400);

    const [row] = await db.select().from(preferences).where(eq(preferences.userId, ownerId));
    expect(row?.timezone).toBe('Africa/Cairo');
  });

  it('refuses the Forge routes without a token', async () => {
    await request(app.getHttpServer()).get('/api/v1/forge').expect(401);
    await request(app.getHttpServer()).put('/api/v1/users/me/timezone').send({ timeZone: 'UTC' }).expect(401);
  });

  describe('once weekly_forge is on', () => {
    beforeAll(async () => {
      await setFlag(true);
    });

    it('lists weekly_forge in the enabled flags', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/feature-flags').set(as(OWNER)).expect(200);

      expect(featureFlagsResponseSchema.parse(response.body).enabled).toContain('weekly_forge');
    });

    it('enrols the caller at Ore 1 on every ladder on first read, in their own zone', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/forge').set(as(OWNER)).expect(200);

      const forge = forgeResponseSchema.parse(response.body);
      expect(forge.timeZone).toBe('Africa/Cairo');
      expect(forge.ladders.map((ladder) => ladder.ladder)).toEqual([
        'consistency',
        'volume',
        'distance',
        'minutes',
        'nourish',
      ]);
      expect(forge.ladders.every((ladder) => ladder.level === 1 && ladder.band === 'ore')).toBe(true);
    });

    it('lists a closed, unseen week with its summary, and forgets it once acknowledged', async () => {
      // A week from the past, written the way the evaluation job writes it.
      await db.insert(forgeWeeks).values({
        userId: ownerId,
        ladderKey: 'volume',
        weekStart: '2026-01-03',
        timeZone: 'Africa/Cairo',
        closesAt: new Date('2026-01-09T22:00:00Z'),
        total: '2100.00',
        target: '2000.00',
        levelBefore: 1,
        levelAfter: 2,
        bandBefore: 'ore',
        bandAfter: 'ore',
        outcome: 'hit',
        missStreakAfter: 0,
        temperedHoldWeeksAfter: 0,
        forgedStreakAfter: 0,
        rulesVersion: 1,
      });

      const pending = forgePendingWeeksResponseSchema.parse(
        (await request(app.getHttpServer()).get('/api/v1/forge/weeks/pending').set(as(OWNER)).expect(200)).body,
      );
      expect(pending.weeks.map((week) => week.weekStart)).toContain('2026-01-03');

      await request(app.getHttpServer()).post('/api/v1/forge/weeks/2026-01-03/ack').set(as(OWNER)).expect(204);
      await request(app.getHttpServer()).post('/api/v1/forge/weeks/2026-01-03/ack').set(as(OWNER)).expect(204);

      const after = forgePendingWeeksResponseSchema.parse(
        (await request(app.getHttpServer()).get('/api/v1/forge/weeks/pending').set(as(OWNER)).expect(200)).body,
      );
      expect(after.weeks.map((week) => week.weekStart)).not.toContain('2026-01-03');
    });

    it('answers 404 for acknowledging a week the caller never had, and 400 for a malformed one', async () => {
      await request(app.getHttpServer()).post('/api/v1/forge/weeks/2019-01-05/ack').set(as(OWNER)).expect(404);
      await request(app.getHttpServer()).post('/api/v1/forge/weeks/not-a-week/ack').set(as(OWNER)).expect(400);
    });

    it("shows the athlete's public ladders on their profile, and never Nourish", async () => {
      const response = await request(app.getHttpServer()).get(`/api/v1/athletes/${ownerId}`).set(as(VIEWER)).expect(200);

      const profile = publicProfileResponseSchema.parse(response.body);
      expect(profile.forge?.ladders.map((ladder) => ladder.ladder)).toEqual(['consistency', 'volume', 'distance', 'minutes']);
    });

    it('never enrols a stranger just because their profile was read', async () => {
      const [viewer] = await db.select().from(users).where(eq(users.email, VIEWER.email));

      await request(app.getHttpServer()).get(`/api/v1/athletes/${viewer!.id}`).set(as(OWNER));

      expect(await db.select().from(forgeUserLadders).where(eq(forgeUserLadders.userId, viewer!.id))).toEqual([]);
    });
  });
});
