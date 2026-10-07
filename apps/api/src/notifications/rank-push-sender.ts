import { buildRankPush } from '@forjd/domain';

import type { RankMoveSink } from '../leaderboards/leaderboard-snapshot.service';
import type { PushNotificationService } from './push-notification.service';

/**
 * Turns a rank move found by the weekly snapshot into a queued push (Phase 12F slice 6). One push per person per week (the
 * dedupe key), so re-running the snapshot cannot tell anyone twice. The push policy at queueing decides whether it is sent
 * now, held until after quiet hours, or dropped (switch off, no phone). A failure is left for the snapshot to count.
 */
export class RankPushSender implements RankMoveSink {
  constructor(private readonly push: PushNotificationService) {}

  async queue(move: Parameters<RankMoveSink['queue']>[0]): Promise<boolean> {
    const result = await this.push.enqueue({
      userId: move.userId,
      kind: 'rank',
      dedupeKey: `rank:${move.weekStart}:${move.userId}`,
      content: buildRankPush({ direction: move.direction, cityName: move.cityName, weekStart: move.weekStart }),
      occurredAt: move.occurredAt,
    });
    return result.result === 'queued';
  }
}
