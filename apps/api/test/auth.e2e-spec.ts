import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { inArray } from 'drizzle-orm';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  AuthCredentials,
  AuthIdentity,
  AuthProvider,
  AuthResult,
  AuthSession,
  AUTH_PROVIDER,
  SignUpResult,
} from '../src/auth/providers/auth-provider.interface';
import { Database, DRIZZLE } from '../src/database/database.module';
import { users } from '../src/database/schema/users.schema';

const suiteId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testEmail = `e2e-${suiteId}@example.com`;
const namedEmail = `e2e-named-${suiteId}@example.com`;
const externalId = '11111111-2222-3333-4444-555555555555';
const namedExternalId = '66666666-7777-8888-9999-000000000000';

/**
 * An in-memory stand-in for Supabase. Overriding this single token is the whole point of
 * ADR-008: the flow is exercised end to end with no network and no credentials in CI.
 */
class FakeAuthProvider implements AuthProvider {
  emailConfirmationRequired = false;
  revokedTokens: string[] = [];
  resetRequests: string[] = [];
  private readonly accounts = new Map<string, string>();
  /** Access token -> the address it authenticates, so two accounts can coexist in one suite. */
  private readonly tokenOwners = new Map<string, string>([
    ['access-token', testEmail],
    ['rotated-access-token', testEmail],
    ['named-access-token', namedEmail],
  ]);

  async signUp(credentials: AuthCredentials): Promise<SignUpResult> {
    this.accounts.set(credentials.email, credentials.password);

    return {
      identity: this.identity(credentials.email),
      session: this.emailConfirmationRequired ? null : this.session(credentials.email),
    };
  }

  async signIn(credentials: AuthCredentials): Promise<AuthResult> {
    if (this.accounts.get(credentials.email) !== credentials.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      identity: this.identity(credentials.email),
      session: this.session(credentials.email),
    };
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    if (refreshToken !== 'refresh-token') {
      throw new UnauthorizedException('Could not refresh session');
    }

    return { ...this.session(testEmail), accessToken: 'rotated-access-token' };
  }

  async signOut(accessToken: string): Promise<void> {
    this.revokedTokens.push(accessToken);
  }

  /**
   * Records the attempt and resolves unconditionally, mirroring the real adapter: an
   * unknown address must be indistinguishable from a known one.
   */
  async requestPasswordReset(email: string): Promise<void> {
    this.resetRequests.push(email);
  }

  async verifyAccessToken(accessToken: string): Promise<AuthIdentity> {
    const email = this.tokenOwners.get(accessToken);

    if (!email) {
      throw new UnauthorizedException('Invalid access token');
    }

    return this.identity(email);
  }

  private session(email: string): AuthSession {
    return {
      accessToken: email === namedEmail ? 'named-access-token' : 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-06-01T12:00:00Z'),
    };
  }

  private identity(email: string): AuthIdentity {
    return {
      externalId: email === namedEmail ? namedExternalId : externalId,
      email,
      emailVerified: !this.emailConfirmationRequired,
    };
  }
}

describe('Auth and profile (e2e)', () => {
  let app: INestApplication;
  let authProvider: FakeAuthProvider;
  let db: Database;

  beforeAll(async () => {
    authProvider = new FakeAuthProvider();

    // The suite makes more auth calls than any real user would in a minute, and
    // forgot-password is deliberately limited to 3 per 15 minutes. Rate limiting is
    // asserted by its own unit-level configuration, not by making this suite race a clock.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(authProvider)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    db = app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    // profiles and audit_logs clean up via ON DELETE cascade / set null.
    await db.delete(users).where(inArray(users.email, [testEmail, namedEmail]));
    await app.close();
  });

  it('rejects an invalid registration body before reaching the provider', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(response.body.errors).toHaveProperty('email');
    expect(response.body.errors).toHaveProperty('password');
  });

  it('registers a user and issues a session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: testEmail, password: 'password123' })
      .expect(201);

    expect(response.body.email).toBe(testEmail);
    expect(response.body.session.accessToken).toBe('access-token');
    // The internal id must not be the provider's id (ADR-008 identity mapping).
    expect(response.body.userId).not.toBe(externalId);
  });

  it('stores a display name supplied at registration on the profile', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: namedEmail, password: 'password123', displayName: 'Grace Hopper' })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${registered.body.session.accessToken}`)
      .expect(200);

    expect(me.body.email).toBe(namedEmail);
    expect(me.body.profile.displayName).toBe('Grace Hopper');
  });

  it('logs in, reads the profile, updates it, then logs out', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: 'password123' })
      .expect(200);

    const { accessToken, refreshToken } = login.body;

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(me.body.email).toBe(testEmail);
    expect(me.body.profile.unitSystem).toBe('metric');

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(refreshed.body.accessToken).toBe('rotated-access-token');

    const updated = await request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .send({ displayName: 'Test Lifter', heightCm: 180.5, unitSystem: 'imperial' })
      .expect(200);

    expect(updated.body.displayName).toBe('Test Lifter');
    expect(updated.body.heightCm).toBe(180.5);
    expect(updated.body.unitSystem).toBe('imperial');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(204);

    expect(authProvider.revokedTokens).toContain('rotated-access-token');
  });

  it('rejects a profile update that changes nothing', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: 'password123' })
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({})
      .expect(400);
  });

  it('refuses profile access without a token', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
  });

  it('rejects a malformed address before reaching the provider', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(response.body.errors).toHaveProperty('email');
    expect(authProvider.resetRequests).not.toContain('not-an-email');
  });

  /**
   * The enumeration test. Asserting the two responses are equal to each other — rather than
   * asserting twice against 202 — is what actually catches a future change that starts
   * leaking the difference through a body, a header, or a status.
   */
  it('answers identically for a registered and an unregistered address', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: testEmail });

    const unregistered = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: `absent-${suiteId}@example.com` });

    expect(registered.status).toBe(202);
    expect({ status: registered.status, text: registered.text }).toEqual({
      status: unregistered.status,
      text: unregistered.text,
    });
    // Both reached the provider — the indistinguishability is in the response, not in
    // quietly skipping the work for one of them.
    expect(authProvider.resetRequests).toEqual([testEmail, `absent-${suiteId}@example.com`]);
  });
});
