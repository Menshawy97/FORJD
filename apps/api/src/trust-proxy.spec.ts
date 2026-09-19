import { Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { configureTrustProxy } from './trust-proxy';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

const LIMIT = 2;

/**
 * The global `ThrottlerGuard` keys on `req.ip`. Behind Cloud Run's Google Front End (ADR-015)
 * the TCP peer is the GFE, so without `trust proxy` every client shares one bucket; with a
 * naive `trust proxy: true` the *leftmost* X-Forwarded-For entry -- which the client
 * controls -- becomes the key and the limit is bypassable. Here the supertest socket
 * (127.0.0.1) plays the GFE, and the header value plays what the GFE sends: it appends the
 * real client address as the RIGHTMOST entry, after anything the client itself supplied.
 */
describe('configureTrustProxy + ThrottlerGuard', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: LIMIT }])],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureTrustProxy(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const ping = (forwardedFor: string) =>
    request(app.getHttpServer()).get('/ping').set('X-Forwarded-For', forwardedFor);

  it('gives distinct clients behind the proxy separate buckets', async () => {
    for (let i = 0; i < LIMIT; i += 1) await ping('203.0.113.1').expect(200);
    await ping('203.0.113.1').expect(429);

    // A different client through the same proxy is unaffected.
    await ping('203.0.113.2').expect(200);
  });

  it('cannot be spoofed by extra X-Forwarded-For entries the client prepends', async () => {
    // Real client is 203.0.113.1 (rightmost, appended by the trusted proxy); each request
    // claims a different fake origin on the left.
    for (let i = 0; i < LIMIT; i += 1) await ping(`198.51.100.${i}, 203.0.113.1`).expect(200);

    await ping('198.51.100.99, 203.0.113.1').expect(429);
  });

  it('trusts exactly one hop', () => {
    expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBe(1);
  });
});
