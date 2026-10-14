import { Injectable } from '@nestjs/common';
import { NOTIFICATION_KINDS, type NotificationItem, type NotificationListResponse } from '@forjd/contracts';
import type { User } from '@forjd/domain';

import { PushOutboxRepository } from './push-outbox.repository';

/** How far back the list reaches. The outbox purges finished rows after 30 days, so this is all there is anyway. */
export const NOTIFICATION_FEED_DAYS = 30;
/** A bound on one answer: two kinds of push, each at most a few a week, never come near it. */
export const NOTIFICATION_FEED_LIMIT = 100;

const DAY_MS = 86_400_000;
const isKnownKind = (kind: string): kind is NotificationItem['kind'] =>
  (NOTIFICATION_KINDS as readonly string[]).includes(kind);

/**
 * The notifications list behind the Home bell (emulator walk finding 17, slice B of
 * docs/product/notifications-list-and-profile-counts-plan.md): the caller's own pushes that were sent, newest first. The
 * id comes from the authenticated user, never from the request (CLAUDE.md rule 12). The text is what the push already
 * showed, which never carries a health value (ADR-061).
 */
@Injectable()
export class NotificationsFeedService {
  constructor(private readonly repository: PushOutboxRepository) {}

  async list(user: User, now: Date = new Date()): Promise<NotificationListResponse> {
    const since = new Date(now.getTime() - NOTIFICATION_FEED_DAYS * DAY_MS);
    const rows = await this.repository.listSentForUser(user.id, since, NOTIFICATION_FEED_LIMIT);
    const items: NotificationItem[] = [];
    for (const row of rows) {
      if (!isKnownKind(row.kind) || row.sentAt === null) continue;
      items.push({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        data: row.data,
        sentAt: row.sentAt.toISOString(),
      });
    }
    return { items };
  }
}
