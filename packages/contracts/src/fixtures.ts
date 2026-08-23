import { z } from 'zod';

import {
  meResponseSchema,
  profileResponseSchema,
  publicProfileResponseSchema,
  registerResponseSchema,
  sessionResponseSchema,
} from './index';

/**
 * Canonical examples of every response the API can send, one per shape worth pinning.
 *
 * They exist because the Flutter DTOs in `apps/mobile/lib/features/auth/domain/auth_models.dart`
 * mirror these schemas by hand, and nothing connected the two: a field could be renamed here
 * and the app would keep compiling, keep passing its tests, and return null at runtime.
 *
 * Each sample is parsed by its own schema before being written, so a fixture cannot describe
 * a shape the contract does not accept. The Dart side then parses the written files through
 * the real DTOs. Drift in either direction becomes a failing test rather than a field that
 * quietly stops arriving.
 *
 * The values are invented, never captured from a live response. A real one carries a working
 * access token and a real address, and neither belongs in the repository.
 */
export interface ResponseFixture<T extends z.ZodTypeAny> {
  schema: T;
  sample: z.input<T>;
}

const session = {
  accessToken: 'fixture-access-token',
  refreshToken: 'fixture-refresh-token',
  expiresAt: '2026-01-01T01:00:00.000Z',
};

/**
 * All-off, which is what every account starts as and what the opt-in decision means. The
 * consent timestamp is null precisely because consent has not been given.
 */
const privacy = {
  publicProfile: false,
  leaderboardOptIn: false,
  locationForLeaderboard: false,
  aiFeaturesConsent: false,
  aiFeaturesConsentAt: null,
  crashDiagnostics: false,
};

const profile = {
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Ada Lovelace',
  dateOfBirth: '1990-07-04',
  sex: 'female' as const,
  heightCm: 172.5,
  unitSystem: 'metric' as const,
  // Deliberately not the metric preset's own values. A fixture where every unit agreed with
  // `unitSystem` would document the one case that cannot catch a client still reading the
  // deprecated preset instead of the three real fields; this one breaks such a client
  // visibly, which is the entire job of a pinned fixture.
  weightUnit: 'lb' as const,
  distanceUnit: 'km' as const,
  energyUnit: 'kJ' as const,
  trainingGoals: ['get_stronger', 'improve_endurance'] as const,
  activities: ['strength', 'hyrox'] as const,
  city: 'Cairo',
  avatarUrl: 'https://example.com/avatar.png',
  plan: 'free' as const,
};

/**
 * Keyed by the file each one is written to. Adding a response schema without adding a
 * fixture here is caught by the Dart test, which fails on a file it has no parser for and
 * on a parser with no file.
 */
export const responseFixtures = {
  'session-response': { schema: sessionResponseSchema, sample: session },

  'register-response': {
    schema: registerResponseSchema,
    sample: {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'ada@example.com',
      emailVerified: true,
      session,
    },
  },

  /**
   * The case a client is most likely to get wrong. When the project requires email
   * confirmation the account exists and the session does not, so `session` is null by
   * contract rather than by accident.
   */
  'register-response-awaiting-confirmation': {
    schema: registerResponseSchema,
    sample: {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'ada@example.com',
      emailVerified: false,
      session: null,
    },
  },

  'profile-response': { schema: profileResponseSchema, sample: profile },

  /**
   * Every nullable field actually null, which is what a profile looks like at signup.
   *
   * The unit and list fields are the interesting part: they are **not** null, because their
   * columns are NOT NULL with defaults. A client that treats them as nullable is wrong, and
   * this fixture is where that gets caught rather than at runtime on a fresh account.
   */
  'profile-response-empty': {
    schema: profileResponseSchema,
    sample: {
      userId: '11111111-1111-4111-8111-111111111111',
      displayName: null,
      dateOfBirth: null,
      sex: null,
      heightCm: null,
      unitSystem: 'metric' as const,
      weightUnit: 'kg' as const,
      distanceUnit: 'km' as const,
      energyUnit: 'kcal' as const,
      trainingGoals: [],
      activities: [],
      city: null,
      avatarUrl: null,
      // Not null — plan is never absent, unlike every other field on this fixture, because
      // it does not come from the profile row at all. It comes from SubscriptionService,
      // which answers for every user regardless of what else they have set.
      plan: 'free' as const,
    },
  },

  'me-response': {
    schema: meResponseSchema,
    sample: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'ada@example.com',
      profile,
      privacy,
    },
  },

  'me-response-no-profile': {
    schema: meResponseSchema,
    sample: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'ada@example.com',
      profile: null,
      // Privacy is present even when the profile is not: the row is created with the
      // account, so a client must never treat it as optional the way it does `profile`.
      privacy,
    },
  },

  'public-profile-response': {
    schema: publicProfileResponseSchema,
    sample: {
      userId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Ada Lovelace',
      avatarUrl: 'https://example.com/avatar.png',
      city: 'Cairo',
      trainingGoals: ['get_stronger', 'improve_endurance'],
      activities: ['strength', 'hyrox'],
      isSelf: false,
    },
  },

  /**
   * Every nullable field null and every list empty, which is what a bare-minimum public
   * profile looks like — a user who set nothing beyond a display name.
   */
  'public-profile-response-empty': {
    schema: publicProfileResponseSchema,
    sample: {
      userId: '11111111-1111-4111-8111-111111111111',
      displayName: null,
      avatarUrl: null,
      city: null,
      trainingGoals: [],
      activities: [],
      isSelf: false,
    },
  },
} satisfies Record<string, ResponseFixture<z.ZodTypeAny>>;

export type ResponseFixtureName = keyof typeof responseFixtures;
