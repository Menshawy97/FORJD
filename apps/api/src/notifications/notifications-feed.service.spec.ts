import type { User } from '@forjd/domain';

import { NOTIFICATION_FEED_DAYS, NOTIFICATION_FEED_LIMIT, NotificationsFeedService } from './notifications-feed.service';
import { PushOutboxRepository } from './push-outbox.repository';

// The notifications list behind the Home bell (emulator walk finding 17, slice B of
// docs/product/notifications-list-and-profile-counts-plan.md). The caller's own sent pushes from the last 30 days.
describe('NotificationsFeedService', () => {
  const user = { id: 'user-1', email: 'athlete@example.com' } as User;
  const NOW = new Date('2026-10-14T12:00:00.000Z');

  function build(rows: Array<Record<string, unknown>> = []) {
    const repository: jest.Mocked<Pick<PushOutboxRepository, 'listSentForUser'>> = {
      listSentForUser: jest.fn().mockResolvedValue(rows),
    };
    const service = new NotificationsFeedService(repository as unknown as PushOutboxRepository);
    return { service, repository };
  }

  it("reads only the caller's own pushes, from the last 30 days, with a limit", async () => {
    const { service, repository } = build();

    await service.list(user, NOW);

    expect(NOTIFICATION_FEED_DAYS).toBe(30);
    expect(repository.listSentForUser).toHaveBeenCalledWith(
      'user-1',
      new Date('2026-09-14T12:00:00.000Z'),
      NOTIFICATION_FEED_LIMIT,
    );
  });

  it('answers each push with the title, body and data it showed, and when it was sent', async () => {
    const { service } = build([
      {
        id: 'a1',
        kind: 'rank',
        title: 'You moved up in Cairo',
        body: 'See the leaderboard.',
        data: { type: 'rank', weekStart: '2026-10-10' },
        sentAt: new Date('2026-10-13T09:00:00.000Z'),
        dedupeKey: 'rank:x',
        userId: 'user-1',
      },
    ]);

    await expect(service.list(user, NOW)).resolves.toEqual({
      items: [
        {
          id: 'a1',
          kind: 'rank',
          title: 'You moved up in Cairo',
          body: 'See the leaderboard.',
          data: { type: 'rank', weekStart: '2026-10-10' },
          sentAt: '2026-10-13T09:00:00.000Z',
        },
      ],
    });
  });

  it('leaves out a row of a kind the list does not know, or one with no sent time', async () => {
    const base = { title: 't', body: 'b', data: {}, sentAt: new Date('2026-10-13T09:00:00.000Z') };
    const { service } = build([
      { ...base, id: 'x1', kind: 'recovery' },
      { ...base, id: 'x2', kind: 'pr', sentAt: null },
      { ...base, id: 'x3', kind: 'pr' },
    ]);

    const { items } = await service.list(user, NOW);

    expect(items.map((item) => item.id)).toEqual(['x3']);
  });
});
