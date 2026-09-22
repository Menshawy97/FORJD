import { waitlistSignupRequestSchema } from '@forjd/contracts';
import type { Request } from 'express';

import {
  getBodySchema,
  getClassGuards,
  getMethodGuards,
} from '../test-support/controller-metadata';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

describe('WaitlistController', () => {
  let service: jest.Mocked<Pick<WaitlistService, 'signUp'>>;
  let controller: WaitlistController;

  beforeEach(() => {
    service = { signUp: jest.fn() };
    controller = new WaitlistController(service as unknown as WaitlistService);
  });

  it('binds the body to waitlistSignupRequestSchema', () => {
    expect(getBodySchema(WaitlistController, 'signUp')).toBe(waitlistSignupRequestSchema);
  });

  it('carries no auth guard -- the endpoint is intentionally public', () => {
    // Public by absence, the convention this codebase uses everywhere (see cors.ts /
    // AuthController's register route): no @UseGuards means no guard is checked.
    expect(getClassGuards(WaitlistController)).toHaveLength(0);
    expect(getMethodGuards(WaitlistController, 'signUp')).toHaveLength(0);
  });

  it("passes the body and the caller's address to the service, and returns its result", async () => {
    const body = { email: 'a@example.com', turnstileToken: 'token' };
    const result = { status: 'accepted' as const };
    service.signUp.mockResolvedValue(result);
    const req = { ip: '203.0.113.7' } as Request;

    await expect(controller.signUp(body, req)).resolves.toBe(result);

    expect(service.signUp).toHaveBeenCalledWith(body, '203.0.113.7');
  });
});
