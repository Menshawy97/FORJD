import type { PushNotificationService } from './push-notification.service';
import { RankPushSender } from './rank-push-sender';

// Phase 12F slice 6. A rank move from the weekly snapshot becomes one push per person per week (the key), built by the one
// builder that decides what a push may say (ADR-061): a direction and a city, no rank, score or anything about the person.
describe('RankPushSender', () => {
  const OCCURRED = new Date('2026-09-19T00:20:00Z');

  it('queues a rank push keyed by the week and the person', async () => {
    const push = { enqueue: jest.fn().mockResolvedValue({ result: 'queued' }) };
    const sender = new RankPushSender(push as unknown as PushNotificationService);

    const queued = await sender.queue({ userId: 'user-1', direction: 'up', cityName: 'Cairo', weekStart: '2026-09-19', occurredAt: OCCURRED });

    expect(queued).toBe(true);

    expect(push.enqueue).toHaveBeenCalledWith({
      userId: 'user-1',
      kind: 'rank',
      dedupeKey: 'rank:2026-09-19:user-1',
      content: { title: 'You moved up in Cairo', body: 'See the leaderboard.', data: { type: 'rank', weekStart: '2026-09-19' } },
      occurredAt: OCCURRED,
    });
  });

  it('says no when the push was a repeat or the policy dropped it', async () => {
    const push = {
      enqueue: jest
        .fn()
        .mockResolvedValueOnce({ result: 'duplicate' })
        .mockResolvedValueOnce({ result: 'dropped', reason: 'switch_off' }),
    };
    const sender = new RankPushSender(push as unknown as PushNotificationService);
    const move = { userId: 'u', direction: 'up' as const, cityName: 'Cairo', weekStart: '2026-09-19', occurredAt: OCCURRED };

    await expect(sender.queue(move)).resolves.toBe(false);
    await expect(sender.queue(move)).resolves.toBe(false);
  });

  it('lets a failure out, for the snapshot to count', async () => {
    const push = { enqueue: jest.fn().mockRejectedValue(new Error('db down')) };
    const sender = new RankPushSender(push as unknown as PushNotificationService);

    await expect(
      sender.queue({ userId: 'u', direction: 'down', cityName: 'Cairo', weekStart: '2026-09-19', occurredAt: OCCURRED }),
    ).rejects.toThrow('db down');
  });
});
