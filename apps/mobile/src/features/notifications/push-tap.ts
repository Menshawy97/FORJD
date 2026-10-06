import { LOCAL_NOTIFICATION_ID_PREFIX, type TapLike } from './local-notifications';

/**
 * Which screen a tap on a push opens (Phase 12F, ADR-061). The push's data is a kind and an id and nothing else, and a tap
 * is never trusted: the kind must be one we send, and an id must look like an id before it becomes part of a route, so a
 * crafted notification cannot open an arbitrary screen. A notification that is one of FORJD's own planned local ones is not
 * ours to route here (`routeForLocalNotificationTap` has it); every other notification opens nothing.
 */
const SESSION_ID = /^[0-9a-fA-F-]{8,64}$/;

export function routeForPushTap(response: TapLike): string | null {
  const { identifier, content } = response.notification.request;
  if (identifier.startsWith(LOCAL_NOTIFICATION_ID_PREFIX)) return null;
  const data = content.data as { type?: unknown; sessionId?: unknown } | undefined | null;
  if (data?.type === 'rank') return '/rank';
  if (data?.type === 'pr' && typeof data.sessionId === 'string' && SESSION_ID.test(data.sessionId)) {
    return `/workout/${data.sessionId}`;
  }
  return null;
}
