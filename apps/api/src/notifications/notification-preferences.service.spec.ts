import type { User } from '@forjd/domain';

import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';

describe('NotificationPreferencesService (Phase 12D)', () => {
  const user = { id: 'user-1', email: 'athlete@example.com' } as User;
  const switches = { workout: true, recovery: true, pr: true, rank: false, weekly: true };

  function build() {
    const repository: jest.Mocked<Pick<NotificationPreferencesRepository, 'get' | 'upsert'>> = {
      get: jest.fn(),
      upsert: jest.fn(),
    };
    const service = new NotificationPreferencesService(repository as unknown as NotificationPreferencesRepository);
    return { service, repository };
  }

  describe('get', () => {
    it("reads the caller's own row, by the caller's id", async () => {
      const { service, repository } = build();
      repository.get.mockResolvedValue({ preferences: switches, updatedAt: new Date('2026-10-05T12:00:00.000Z') });

      const response = await service.get(user);

      expect(repository.get).toHaveBeenCalledWith('user-1');
      expect(response).toEqual({ ...switches, updatedAt: '2026-10-05T12:00:00.000Z' });
    });

    it('answers a null timestamp when nothing was ever saved', async () => {
      const { service, repository } = build();
      repository.get.mockResolvedValue({ preferences: switches, updatedAt: null });

      expect((await service.get(user)).updatedAt).toBeNull();
    });
  });

  describe('update', () => {
    it("saves only the switches sent, under the caller's id, and returns the saved row", async () => {
      const { service, repository } = build();
      repository.upsert.mockResolvedValue({
        preferences: { ...switches, rank: true },
        updatedAt: new Date('2026-10-05T12:30:00.000Z'),
      });

      const response = await service.update(user, { rank: true });

      expect(repository.upsert).toHaveBeenCalledWith('user-1', { rank: true });
      expect(response).toEqual({ ...switches, rank: true, updatedAt: '2026-10-05T12:30:00.000Z' });
    });
  });
});
