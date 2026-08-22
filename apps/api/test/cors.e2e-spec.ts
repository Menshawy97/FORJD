import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  AuthIdentity,
  AuthProvider,
  AuthResult,
  AuthSession,
  AUTH_PROVIDER,
  SignUpResult,
} from '../src/auth/providers/auth-provider.interface';
import { applyCors } from '../src/cors';

/**
 * Phase 5 (mobile pivot): the mobile client is a native app in production and never sends
 * an `Origin` header, so CORS is invisible to it there. It matters in exactly one place —
 * `expo start`'s web preview and any browser-based debugging of the dev bundle, which run
 * from a LAN IP or `exp://` origin, not `localhost`. This suite is the executable check for
 * that dev-loop origin, not a general CORS policy audit.
 */
class NoopAuthProvider implements AuthProvider {
  async signUp(): Promise<SignUpResult> {
    throw new Error('not used by this suite');
  }
  async signIn(): Promise<AuthResult> {
    throw new Error('not used by this suite');
  }
  async refreshSession(): Promise<AuthSession> {
    throw new Error('not used by this suite');
  }
  async signOut(): Promise<void> {}
  async requestPasswordReset(): Promise<void> {}
  async verifyAccessToken(): Promise<AuthIdentity> {
    throw new Error('not used by this suite');
  }
}

describe('CORS for the Expo dev client (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUTH_PROVIDER)
      .useValue(new NoopAuthProvider())
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    applyCors(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a preflight from a LAN-IP Expo dev origin', async () => {
    const devOrigin = 'http://192.168.1.42:8081';

    const response = await request(app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', devOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect([200, 204]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBe(devOrigin);
    expect(response.headers['access-control-allow-methods']).toEqual(
      expect.stringContaining('POST'),
    );
  });

  it('answers a preflight from an exp:// origin', async () => {
    const devOrigin = 'exp://192.168.1.42:8081';

    const response = await request(app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', devOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect([200, 204]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBe(devOrigin);
  });

  it('lets the actual (non-preflight) request through with the CORS header attached', async () => {
    const devOrigin = 'http://192.168.1.42:8081';

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', devOrigin)
      .send({ email: 'not-a-real-user@example.com', password: 'whatever' });

    // Credentials are wrong (401) — the point here is that the response is not blocked by
    // CORS: the allow-origin header is present regardless of the auth outcome.
    expect(response.headers['access-control-allow-origin']).toBe(devOrigin);
  });
});
