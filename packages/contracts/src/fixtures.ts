import { z } from 'zod';

import {
  exerciseListResponseSchema,
  exerciseResponseSchema,
  foodListResponseSchema,
  foodResponseSchema,
  macroGoalsResponseSchema,
  meResponseSchema,
  nutritionLogEntryResponseSchema,
  nutritionLogListResponseSchema,
  profileResponseSchema,
  programEnrollmentResponseSchema,
  programListResponseSchema,
  programResponseSchema,
  publicProfileResponseSchema,
  registerResponseSchema,
  savedMealListResponseSchema,
  savedMealResponseSchema,
  sessionResponseSchema,
  exerciseHistoryResponseSchema,
  workoutSessionListResponseSchema,
  workoutSessionResponseSchema,
  workoutStatsResponseSchema,
  workoutTemplateListResponseSchema,
  workoutTemplateResponseSchema,
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
  username: 'ada',
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
      username: null,
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
      username: 'ada',
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
      username: null,
      avatarUrl: null,
      city: null,
      trainingGoals: [],
      activities: [],
      isSelf: false,
    },
  },

  /**
   * The list envelope, pinned once so every list endpoint that adopts it inherits a fixture
   * of the shape rather than each inventing its own.
   *
   * Deliberately a *full* page with a non-null `nextCursor`: the interesting case is the one
   * where more results exist, because a client that stops paging on a truthy-check rather
   * than a null-check is only wrong here. The two rows differ in `isCustom` and `imageUrl`
   * together, which is the real correlation — a user-authored exercise has no media.
   */
  'exercise-list-response': {
    schema: exerciseListResponseSchema,
    sample: {
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Barbell Bench Press',
          slug: 'barbell-bench-press',
          category: 'strength' as const,
          measure: 'weight' as const,
          primaryMuscles: ['chest' as const],
          equipment: ['barbell' as const],
          imageUrl: 'https://media.example.com/exercises/bench-0.jpg',
          isCustom: false,
          isFavourite: true,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Sandbag Carry',
          slug: 'sandbag-carry',
          category: 'cross_training' as const,
          measure: 'distance' as const,
          primaryMuscles: ['forearms' as const, 'traps' as const],
          equipment: [],
          imageUrl: null,
          isCustom: true,
          isFavourite: false,
        },
      ],
      nextCursor: 'eyJuYW1lIjoiU2FuZGJhZyBDYXJyeSIsImlkIjoiMjIyIn0',
    },
  },

  /**
   * No results — a search that matched nothing, or the Favourites chip before anything is
   * starred. `nextCursor` is null rather than absent: end-of-list is stated, never implied.
   */
  'exercise-list-response-empty': {
    schema: exerciseListResponseSchema,
    sample: { items: [], nextCursor: null },
  },

  /**
   * A catalogue exercise in full. `imageUrls` carries resolved URLs and no storage key
   * appears anywhere, which is the property ADR-018's cheap-media-swap depends on.
   */
  'exercise-response': {
    schema: exerciseResponseSchema,
    sample: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Barbell Bench Press',
      slug: 'barbell-bench-press',
      category: 'strength' as const,
      goal: 'hypertrophy' as const,
      measure: 'weight' as const,
      primaryMuscles: ['chest' as const],
      secondaryMuscles: ['triceps' as const, 'shoulders' as const],
      equipment: ['barbell' as const],
      force: 'push' as const,
      level: 'beginner' as const,
      mechanic: 'compound' as const,
      instructions: [
        'Lie back on a flat bench holding the bar at shoulder width.',
        'Lower the bar to the middle of your chest, then press it back up.',
      ],
      imageUrls: [
        'https://media.example.com/exercises/bench-0.jpg',
        'https://media.example.com/exercises/bench-1.jpg',
      ],
      description: null,
      isCustom: false,
      isFavourite: false,
    },
  },

  /** A catalogue food, USDA-sourced -- `isCustom: false`, matching `Food.ownerUserId === null`. */
  'food-response': {
    schema: foodResponseSchema,
    sample: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Bananas, ripe and slightly ripe, raw',
      category: 'fruits' as const,
      macrosPer100g: { kcal: 98, protein: 0.74, carbs: 23, fat: 0.29 },
      servings: [{ label: '1 Banana, Peeled', grams: 115 }],
      isCustom: false,
    },
  },

  /** A user-authored custom food -- no servings beyond the implicit 100 g custom amount every food detail screen offers. */
  'food-list-response': {
    schema: foodListResponseSchema,
    sample: {
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Bananas, ripe and slightly ripe, raw',
          category: 'fruits' as const,
          macrosPer100g: { kcal: 98, protein: 0.74, carbs: 23, fat: 0.29 },
          servings: [{ label: '1 Banana, Peeled', grams: 115 }],
          isCustom: false,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: "Mom's protein pancakes",
          category: 'grains' as const,
          macrosPer100g: { kcal: 210, protein: 12, carbs: 28, fat: 5 },
          servings: [],
          isCustom: true,
        },
      ],
    },
  },

  /** Zero is a real value here -- an account with no goals set never reaches this fixture (the endpoint 404s instead), so this always describes a saved row. */
  'macro-goals-response': {
    schema: macroGoalsResponseSchema,
    sample: { kcal: 2400, protein: 180, carbs: 240, fat: 80 },
  },

  /** `groupId` null -- an entry logged individually, not part of a saved-meal group. */
  'nutrition-log-entry-response': {
    schema: nutritionLogEntryResponseSchema,
    sample: {
      id: '33333333-3333-4333-8333-333333333333',
      foodId: '11111111-1111-4111-8111-111111111111',
      loggedDate: '2026-08-31',
      slot: 'breakfast' as const,
      servingLabel: '1 Banana, Peeled',
      grams: 115,
      kcal: 112.7,
      protein: 0.85,
      carbs: 26.45,
      fat: 0.33,
      groupId: null,
      groupName: null,
    },
  },

  'nutrition-log-list-response': {
    schema: nutritionLogListResponseSchema,
    sample: {
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          foodId: '11111111-1111-4111-8111-111111111111',
          loggedDate: '2026-08-31',
          slot: 'breakfast' as const,
          servingLabel: '1 Banana, Peeled',
          grams: 115,
          kcal: 112.7,
          protein: 0.85,
          carbs: 26.45,
          fat: 0.33,
          groupId: null,
          groupName: null,
        },
        {
          // Two rows sharing a groupId -- what the dashboard collapses into one "N items" row,
          // both carrying the saved meal's name via groupName (the Phase H follow-up fix).
          id: '44444444-4444-4444-8444-444444444444',
          foodId: '22222222-2222-4222-8222-222222222222',
          loggedDate: '2026-08-31',
          slot: 'lunch' as const,
          servingLabel: '2 pancakes (120g)',
          grams: 120,
          kcal: 252,
          protein: 14.4,
          carbs: 33.6,
          fat: 6,
          groupId: '55555555-5555-4555-8555-555555555555',
          groupName: 'Breakfast — usual',
        },
      ],
    },
  },

  'saved-meal-response': {
    schema: savedMealResponseSchema,
    sample: {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Breakfast — usual',
      items: [{ foodId: '11111111-1111-4111-8111-111111111111', servingLabel: '1 Banana, Peeled', grams: 115 }],
    },
  },

  /** No saved meals yet -- the empty state `savedMeals`'s own copy describes. */
  'saved-meal-list-response-empty': {
    schema: savedMealListResponseSchema,
    sample: { items: [] },
  },

  /**
   * A curated template with two blocks -- the second one an `interval` block, deliberately
   * included even though Phase 3 does not implement running it yet: the fixture exists to
   * prove the wire shape already carries every block type, not just the one screen that
   * reads it today.
   */
  'workout-template-response': {
    schema: workoutTemplateResponseSchema,
    sample: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Upper Push',
      activity: 'strength' as const,
      basedOnTemplateId: null,
      notes: null,
      estimatedDurationMinutes: 52,
      isCustom: false,
      blocks: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          type: 'straight_sets' as const,
          orderIndex: 0,
          name: null,
          rounds: null,
          workSeconds: null,
          restSeconds: null,
          capSeconds: null,
          exercises: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              exerciseId: '44444444-4444-4444-8444-444444444444',
              orderIndex: 0,
              setCount: 4,
              targetReps: 8,
              targetRepsMax: null,
              targetWeightKg: 80,
              targetSeconds: null,
              targetDistanceMeters: null,
              restSeconds: 90,
              notes: null,
            },
          ],
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          type: 'interval' as const,
          orderIndex: 1,
          name: 'Conditioning finisher',
          rounds: 8,
          workSeconds: 60,
          restSeconds: 30,
          capSeconds: null,
          exercises: [
            {
              id: '66666666-6666-4666-8666-666666666666',
              exerciseId: '77777777-7777-4777-8777-777777777777',
              orderIndex: 0,
              setCount: null,
              targetReps: null,
              targetRepsMax: null,
              targetWeightKg: null,
              targetSeconds: null,
              targetDistanceMeters: null,
              restSeconds: null,
              notes: null,
            },
          ],
        },
      ],
    },
  },

  /** The "My workouts" list row -- lean on purpose, see `workoutTemplateSummarySchema`'s own docblock. */
  'workout-template-list-response': {
    schema: workoutTemplateListResponseSchema,
    sample: {
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Upper Push — my version',
          activity: 'strength' as const,
          estimatedDurationMinutes: 52,
          exerciseCount: 6,
          isCustom: true,
          // A "Customised preset" badge (train2.png): edited from a curated template.
          basedOnTemplateId: '33333333-3333-4333-8333-333333333333',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Full Body A',
          activity: 'strength' as const,
          estimatedDurationMinutes: 45,
          exerciseCount: 5,
          isCustom: false,
          basedOnTemplateId: null,
        },
      ],
      nextCursor: null,
    },
  },

  /**
   * A completed strength session with one working set logged -- `templateId` non-null
   * (performed against a prescription) and `isLiveTracked: true` (the anti-cheat fact
   * `leaderboard_eligible` reads at query time, per `docs/architecture/security.md`).
   */
  'workout-session-response': {
    schema: workoutSessionResponseSchema,
    sample: {
      id: '11111111-1111-4111-8111-111111111111',
      templateId: '22222222-2222-4222-8222-222222222222',
      name: 'Upper Push',
      activity: 'strength' as const,
      status: 'completed' as const,
      startedAt: '2026-09-02T09:00:00.000Z',
      endedAt: '2026-09-02T09:52:00.000Z',
      durationSeconds: 3120,
      perceivedEffort: 'solid' as const,
      notes: null,
      city: 'Alexandria',
      citySlug: 'alexandria',
      isLiveTracked: true,
      exercises: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          exerciseId: '44444444-4444-4444-8444-444444444444',
          orderIndex: 0,
          measure: 'weight' as const,
          notes: null,
          sets: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              setIndex: 0,
              type: 'working' as const,
              isCompleted: true,
              weightKg: 82.5,
              reps: 6,
              durationSeconds: null,
              distanceMeters: null,
              restSeconds: 90,
              completedAt: '2026-09-02T09:05:00.000Z',
            },
          ],
        },
      ],
    },
  },

  /**
   * The exercise-detail screen's tiles, trend and History list for one exercise (Phase 3J-d).
   *
   * `estimatedOneRepMaxKg` is Epley's estimate from `bestSet`: 100 x 3 gives 106.7, which is
   * exactly where the design's own demo tile of "106 kg" beside "100 kg x 3" comes from.
   */
  'exercise-history-response': {
    schema: exerciseHistoryResponseSchema,
    sample: {
      bestSet: { weightKg: 100, reps: 3, achievedAt: '2026-08-08T10:20:00.000Z' },
      estimatedOneRepMaxKg: 106.7,
      sessions: [
        {
          sessionId: '11111111-1111-4111-8111-111111111111',
          sessionName: 'Push Day',
          performedAt: '2026-08-08T10:00:00.000Z',
          weightKg: 100,
          reps: 3,
        },
      ],
    },
  },

  /**
   * Everything Home reads, in one payload (Phase 3J-c) -- the stat strip's counters, the
   * "This week" bars and "Recent PR".
   *
   * `trainedWeekdays` is indexed like `Date#getDay()`: 1 and 3 are Monday and Wednesday.
   */
  'workout-stats-response': {
    schema: workoutStatsResponseSchema,
    sample: {
      totalSessions: 42,
      sessionsThisMonth: 6,
      weekStreak: 3,
      thisWeek: { sessionCount: 2, trainedWeekdays: [1, 3] },
      recentPersonalRecord: {
        exerciseId: '33333333-3333-4333-8333-333333333333',
        exerciseName: 'Bench Press',
        weightKg: 100,
        reps: 5,
        achievedAt: '2026-09-01T09:05:00.000Z',
      },
    },
  },

  /** The workout history list row -- what the "Previous Workout" card (Phase 3J-b) reads. */
  'workout-session-list-response': {
    schema: workoutSessionListResponseSchema,
    sample: {
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Upper Push',
          activity: 'strength' as const,
          status: 'completed' as const,
          startedAt: '2026-09-02T09:00:00.000Z',
          endedAt: '2026-09-02T09:52:00.000Z',
          durationSeconds: 3120,
          perceivedEffort: 'solid' as const,
        },
      ],
      nextCursor: null,
    },
  },

  /**
   * The program catalogue (Phase 3K2). `daysPerWeek`/`durationWeeks` are two numbers rather than
   * the design's rendered `4 days · 8 weeks` line, and `workoutCount` is counted from the join
   * rows rather than restating `daysPerWeek` -- the two diverge for a custom program with rest
   * days.
   */
  'program-list-response': {
    schema: programListResponseSchema,
    sample: {
      items: [
        {
          id: '3f1a4d64-6b2f-4d0e-9d0a-3c2f9a5e1b77',
          slug: 'upper-lower',
          name: 'Upper / Lower',
          category: 'strength' as const,
          level: 'intermediate' as const,
          daysPerWeek: 4,
          durationWeeks: 8,
          description: 'Balanced strength for 3–5 sessions a week',
          isOwn: false,
          workoutCount: 4,
        },
      ],
    },
  },

  /**
   * One program's overview. Each workout is identified by its **template** id, because a
   * program's workout *is* a workout template -- which is what lets the overview's Start button
   * reuse the existing live-session handoff. `dayOfWeek` is null for a preset, which prescribes a
   * set of workouts rather than a calendar.
   */
  'program-response': {
    schema: programResponseSchema,
    sample: {
      id: '3f1a4d64-6b2f-4d0e-9d0a-3c2f9a5e1b77',
      slug: 'upper-lower',
      name: 'Upper / Lower',
      category: 'strength' as const,
      level: 'intermediate' as const,
      daysPerWeek: 4,
      durationWeeks: 8,
      description: 'Balanced strength for 3–5 sessions a week',
      isOwn: false,
      workoutCount: 1,
      version: 1,
      workouts: [
        {
          templateId: '0f6c9d9e-58f4-4b2e-8b52-1a4a2c9d8e01',
          name: 'Upper Body A',
          activity: 'strength' as const,
          orderIndex: 0,
          dayOfWeek: null,
          exerciseNames: ['Barbell Bench Press - Medium Grip', 'Bent Over Barbell Row'],
        },
      ],
    },
  },

  /**
   * What the athlete is following. `programVersion` is the version the enrolment *began* under,
   * not the program's current one -- the two differ the moment a program is edited.
   */
  'program-enrollment-response': {
    schema: programEnrollmentResponseSchema,
    sample: {
      enrollment: {
        id: 'a2b7c1d4-3e5f-4a6b-8c9d-0e1f2a3b4c5d',
        programId: '3f1a4d64-6b2f-4d0e-9d0a-3c2f9a5e1b77',
        programSlug: 'upper-lower',
        programName: 'Upper / Lower',
        programVersion: 1,
        startedAt: '2026-09-01T08:30:00.000Z',
      },
    },
  },
} satisfies Record<string, ResponseFixture<z.ZodTypeAny>>;

export type ResponseFixtureName = keyof typeof responseFixtures;
