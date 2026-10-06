import type { User } from '@forjd/domain';

import { PushTokensRepository } from './push-tokens.repository';
import { PushTokensService } from './push-tokens.service';

describe('PushTokensService (Phase 12F)', () => {
  const user = { id: 'user-1', email: 'athlete@example.com' } as User;

  function build() {
    const repository: jest.Mocked<Pick<PushTokensRepository, 'register' | 'remove'>> = {
      register: jest.fn(),
      remove: jest.fn(),
    };
    const service = new PushTokensService(repository as unknown as PushTokensRepository);
    return { service, repository };
  }

  it("registers the token under the caller's own id, never one from the request", async () => {
    const { service, repository } = build();
    repository.register.mockResolvedValue(undefined);

    await service.register(user, { token: 'ExponentPushToken[abc]', platform: 'android' });

    expect(repository.register).toHaveBeenCalledWith('user-1', 'ExponentPushToken[abc]', 'android');
  });

  it("removes the token for the caller, and a token that is not theirs or not stored is not an error", async () => {
    const { service, repository } = build();
    repository.remove.mockResolvedValue(false);

    await expect(service.remove(user, { token: 'ExponentPushToken[abc]' })).resolves.toBeUndefined();

    expect(repository.remove).toHaveBeenCalledWith('user-1', 'ExponentPushToken[abc]');
  });
});
