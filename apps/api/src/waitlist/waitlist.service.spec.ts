import { BadRequestException } from '@nestjs/common';

import type { TurnstileClient } from '../integrations/turnstile/turnstile-client';
import { WaitlistRepository } from './waitlist.repository';
import { WaitlistService } from './waitlist.service';

describe('WaitlistService', () => {
  let repository: jest.Mocked<Pick<WaitlistRepository, 'signUp'>>;
  let turnstile: jest.Mocked<TurnstileClient>;
  let service: WaitlistService;

  beforeEach(() => {
    repository = { signUp: jest.fn() };
    turnstile = { verify: jest.fn() };
    service = new WaitlistService(repository as unknown as WaitlistRepository, turnstile);
  });

  it('verifies the Turnstile token before storing anything', async () => {
    turnstile.verify.mockResolvedValue(true);

    const result = await service.signUp(
      { email: 'a@example.com', turnstileToken: 'token' },
      '203.0.113.7',
    );

    expect(turnstile.verify).toHaveBeenCalledWith('token', '203.0.113.7');
    expect(repository.signUp).toHaveBeenCalledWith('a@example.com');
    expect(result).toEqual({ status: 'accepted' });
  });

  it('stores nothing and refuses with 400 when Turnstile rejects the token', async () => {
    turnstile.verify.mockResolvedValue(false);

    await expect(
      service.signUp({ email: 'a@example.com', turnstileToken: 'bad-token' }, '203.0.113.7'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.signUp).not.toHaveBeenCalled();
  });

  it('answers a repeat sign-up exactly like a new one', async () => {
    // The repository's on-conflict-do-nothing insert cannot tell a duplicate from a new row,
    // and the service must not either -- the only branch here is Turnstile, not the outcome.
    turnstile.verify.mockResolvedValue(true);
    repository.signUp.mockResolvedValue(undefined);

    const first = await service.signUp({ email: 'a@example.com', turnstileToken: 'token' });
    const second = await service.signUp({ email: 'a@example.com', turnstileToken: 'token' });

    expect(first).toEqual(second);
    expect(first).toEqual({ status: 'accepted' });
  });

  it('works without a caller address, for callers behind no trusted proxy in tests', async () => {
    turnstile.verify.mockResolvedValue(true);

    await service.signUp({ email: 'a@example.com', turnstileToken: 'token' });

    expect(turnstile.verify).toHaveBeenCalledWith('token', undefined);
  });
});
