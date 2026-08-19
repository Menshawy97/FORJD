import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
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

const testEmail = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const externalId = '11111111-2222-3333-4444-555555555555';

/**
 * An in-memory stand-in for Supabase. Overriding this single token is the whole point of
 * ADR-008: the flow is exercised end to end with no network and no credentials in CI.
 */
class FakeAuthProvider implements AuthProvider {
  emailConfirmationRequired = false;
  revokedTokens: string[] = [];
  private readonly accounts = new Map<string, string>();

  async signUp(credentials: AuthCredentials): Promise<SignUpResult> {
    this.accounts.set(credentials.email, credentials.password);

    return {
      identity: this.identity(credentials.email),
      session: this.emailConfirmationRequired ? null : this.session(),
    };
  }

  async signIn(credentials: AuthCredentials): Promise<AuthResult> {
    if (this.accounts.get(credentials.email) !== credentials.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { identity: this.identity(credentials.email), session: this.session() };
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    if (refreshToken !== 'refresh-token') {
      throw new UnauthorizedException('Could not refresh session');
    }

    return { ...this.session(), accessToken: 'rotated-access-token' };
  }

  async signOut(accessToken: string): Promise<void> {
    this.revokedTokens.push(accessToken);
  }

  async verifyAccessToken(accessToken: string): Promise<AuthIdentity> {
    if (!['access-token', 'rotated-access-token'].includes(accessToken)) {
      throw new UnauthorizedException('Invalid access token');
    }

    return this.identity(testEmail);
  }

  private session(): AuthSession {
    return {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-06-01T12:00:00Z'),
    };
  }

  private identity(email: string): AuthIdentity {
    return { externalId, email, emailVerified: !this.emailConfirmationRequired };
  }
}

describe('Auth and profile (e2e)', () => {
  let app: INestApplication;
  let authProvider: FakeAuthProvider;
  let db: Database;

  beforeAll(async () => {
    authProvider = new FakeAuthProvider();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(authProvider)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    db = app.get<Database>(DRIZZLE);
  });

  afterAll(async () => {
    // profiles and audit_logs clean up via ON DELETE cascade / set null.
    await db.delete(users).where(eq(users.email, testEmail));
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
});
