// RED first: the ember gradient is the prototype's *default* atmosphere, so "which screens
// get it" has one answer — all of them. `ScreenBackground` existing is not the fix; every
// screen mounting it is. See src/components/__tests__/screen-background.test.tsx for the
// geometry itself.
//
// This also pins 2b: welcome, login and signup were painted `bg-bg` (#08090A), which
// 02-design-tokens.md annotates as "the desk, not the screen" — the page *outside* the phone
// frame. The frame itself is #101011. Asserting the gradient is present asserts the right
// ground with it, since `ScreenBackground` owns both.
//
// No events are fired here, so several `renderRouter()` calls in one file are safe — the
// hazard documented in signup-field-highlight.test.tsx only applies after an event.
import { renderRouter } from 'expo-router/testing-library';

// Defaults to unauthenticated: `welcome`/`login`/`signup` need that to render at all now that
// _layout.tsx's AuthenticatedGate (Part 1.1 of ui-remediation-and-phase-i-plan.md) redirects an
// authenticated user away from those two routes. `profile` and `train` override to
// authenticated per-test below, since they are gated the other way.
jest.mock('@/auth/secureStorage', () => ({
  hasSession: jest.fn().mockResolvedValue(false),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(() => false),
  consumeSessionExpired: jest.fn(() => false),
}));

// Phase J: profile.tsx now reads real getMe() data for its identity row.
jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn().mockResolvedValue({
    id: 'u1',
    email: 'a@example.com',
    profile: {
      userId: 'u1',
      displayName: 'James Mitchell',
      dateOfBirth: null,
      sex: null,
      heightCm: null,
      unitSystem: 'metric',
      weightUnit: 'kg',
      distanceUnit: 'km',
      energyUnit: 'kcal',
      trainingGoals: [],
      activities: [],
      city: null,
      avatarUrl: null,
      plan: 'free',
    },
    privacy: null,
  }),
  // Phase 3J-b: Train reads templates and the most recent session. Both resolve empty here --
  // this suite asserts the atmosphere gradient, not either list.
  listWorkoutTemplates: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listWorkoutSessions: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getWorkoutSession: jest.fn(),
  // Home reads workout stats (Phase 3J-c). Rejected here -- this suite asserts the atmosphere
  // gradient, and the honest empty state a failed read falls back to renders just as well.
  getWorkoutStats: jest.fn().mockRejectedValue(new Error("no stats in this suite")),
}));

import { getCachedHasSession, hasSession } from '@/auth/secureStorage';

function authenticate() {
  (hasSession as jest.Mock).mockResolvedValue(true);
  (getCachedHasSession as jest.Mock).mockReturnValue(true);
}

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[] | null;
}

function flatten(node: unknown): HostNode[] {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const host = node as HostNode;
  return [host, ...(host.children ?? []).flatMap(flatten)];
}

async function emberGradientCount(url: string, settleOn: RegExp | string) {
  const { findByText, toJSON } = await renderRouter('src/app', { initialUrl: url });
  await findByText(settleOn);
  return flatten(toJSON()).filter((node) => node.type === 'RNSVGRadialGradient').length;
}

describe('every screen is drawn on the ember atmosphere', () => {
  it('welcome', async () => {
    expect(await emberGradientCount('/welcome', /Training\./)).toBe(1);
  });

  it('login', async () => {
    expect(await emberGradientCount('/login', 'Welcome back')).toBe(1);
  });

  it('signup', async () => {
    expect(await emberGradientCount('/signup', 'Create account')).toBe(1);
  });

  it('profile', async () => {
    authenticate();
    expect(await emberGradientCount('/profile', 'James Mitchell')).toBe(1);
  });

  // Train stopped being a placeholder in Phase 3J -- it now lists the athlete's own workouts --
  // so this anchors on the section heading that is always present rather than on the
  // "coming soon" line it used to render. The atmosphere assertion itself is unchanged.
  it('the placeholder screens', async () => {
    authenticate();
    expect(await emberGradientCount('/train', /My workouts/)).toBe(1);
  });
});
