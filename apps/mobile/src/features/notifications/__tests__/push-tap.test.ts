import { routeForPushTap } from '../push-tap';

// Phase 12F slice 4. A push carries only a kind and an id (ADR-061). A tap opens the matching screen, and nothing a
// notification says can make it open anything else: the kind must be one we send and the id must look like an id.
const tap = (data: unknown, identifier = 'expo-push-1') => ({
  notification: { request: { identifier, content: { data } } },
});
const SESSION = '3f2b8c1e-9d4a-4c11-8a55-0b7e6d5c4a99';

describe('routeForPushTap', () => {
  it('opens the session a PR push is about', () => {
    expect(routeForPushTap(tap({ type: 'pr', sessionId: SESSION }))).toBe(`/workout/${SESSION}`);
  });

  it('opens the Rank tab for a leaderboard push', () => {
    expect(routeForPushTap(tap({ type: 'rank', weekStart: '2026-10-10' }))).toBe('/rank');
  });

  it('opens nothing for a PR push whose id is not an id', () => {
    for (const sessionId of ['../../delete-account', 'a/b', '', 'x'.repeat(200), 42, null, undefined, '<script>', '../x?y=1']) {
      expect(routeForPushTap(tap({ type: 'pr', sessionId }))).toBeNull();
    }
  });

  it('opens nothing for a kind it does not send, or for data that is missing or not an object', () => {
    for (const data of [{ type: 'recovery' }, { type: 'delete' }, { sessionId: SESSION }, {}, null, undefined, 'rank', 7]) {
      expect(routeForPushTap(tap(data))).toBeNull();
    }
  });

  it("leaves FORJD's own planned local notifications to their own router", () => {
    expect(routeForPushTap(tap({ type: 'rank' }, 'forjd-local:weekly:2026-10-10'))).toBeNull();
  });
});
