import { updateProfileRequestSchema } from '@forjd/contracts';
import { ACTIVITIES, TRAINING_GOALS } from '@forjd/domain';

/**
 * Pins the boundary validation for the two chip lists.
 *
 * It lives here rather than in @forjd/contracts because that package has no test runner, and
 * the API is where these rules are actually enforced — `UsersController` runs every request
 * body through `ZodValidationPipe(updateProfileRequestSchema)`, so this is a test of the
 * check that really guards the column.
 *
 * The rules matter because **nothing at the database level bounds these arrays**. `text[]`
 * has no cardinality limit and no membership constraint, and the repository's read-side
 * filter is graceful degradation for a narrowed value set, not an input check. If this
 * schema stops rejecting, the database accepts whatever arrives.
 */
describe('updateProfileRequestSchema — chip lists', () => {
  const parse = (body: unknown) => updateProfileRequestSchema.safeParse(body);

  it('accepts a valid selection', () => {
    expect(parse({ trainingGoals: ['get_stronger', 'feel_better'] }).success).toBe(true);
    expect(parse({ activities: ['strength', 'hyrox'] }).success).toBe(true);
  });

  /**
   * Clearing every chip is a real choice the design allows — `goals` lets both lists go to
   * zero. It must not be confused with omitting the field.
   */
  it('accepts an empty selection', () => {
    expect(parse({ trainingGoals: [] }).success).toBe(true);
    expect(parse({ activities: [] }).success).toBe(true);
  });

  it('accepts every known value at once', () => {
    expect(parse({ trainingGoals: [...TRAINING_GOALS] }).success).toBe(true);
    expect(parse({ activities: [...ACTIVITIES] }).success).toBe(true);
  });

  it('rejects a value outside the known set', () => {
    expect(parse({ trainingGoals: ['get_swole'] }).success).toBe(false);
    expect(parse({ activities: ['curling'] }).success).toBe(false);
  });

  /**
   * `['strength', 'strength']` is not a different selection from `['strength']`. Allowing it
   * would give one UI state two stored representations, and every later reader — a count, a
   * leaderboard grouping, a diff — would have to decide which one it meant.
   */
  it('rejects duplicates', () => {
    expect(parse({ trainingGoals: ['get_stronger', 'get_stronger'] }).success).toBe(false);
    expect(parse({ activities: ['strength', 'strength'] }).success).toBe(false);
  });

  /**
   * The bound is the length of the value set itself. A request naming more members than
   * exist cannot be a real selection, so it is refused at the boundary rather than stored as
   * an array nothing can render.
   */
  it('rejects a list longer than the value set', () => {
    const tooMany = [...TRAINING_GOALS, ...TRAINING_GOALS];

    expect(tooMany.length).toBeGreaterThan(TRAINING_GOALS.length);
    expect(parse({ trainingGoals: tooMany }).success).toBe(false);
  });

  it('rejects null, since an empty array is how a selection is cleared', () => {
    expect(parse({ trainingGoals: null }).success).toBe(false);
    expect(parse({ activities: null }).success).toBe(false);
  });

  it('rejects a bare string where a list is expected', () => {
    expect(parse({ trainingGoals: 'get_stronger' }).success).toBe(false);
  });
});

describe('updateProfileRequestSchema — units', () => {
  const parse = (body: unknown) => updateProfileRequestSchema.safeParse(body);

  it('accepts each unit independently of the others', () => {
    expect(parse({ weightUnit: 'lb' }).success).toBe(true);
    expect(parse({ distanceUnit: 'mi' }).success).toBe(true);
    expect(parse({ energyUnit: 'kJ' }).success).toBe(true);
  });

  /**
   * The combination ADR-016 exists for. It is accepted, not rejected — the service resolves
   * the precedence, and refusing it would fail a request whose intent is unambiguous.
   */
  it('accepts a preset contradicted by an explicit unit', () => {
    expect(parse({ unitSystem: 'imperial', weightUnit: 'kg' }).success).toBe(true);
  });

  /**
   * `kJ` is the SI symbol and its case is semantic — `KJ` and `kj` are not kilojoules. The
   * design draws it this way too, so the contract keeps the exact string rather than
   * lowercasing it for tidiness.
   */
  it('is case-sensitive about kJ', () => {
    expect(parse({ energyUnit: 'kJ' }).success).toBe(true);
    expect(parse({ energyUnit: 'kj' }).success).toBe(false);
    expect(parse({ energyUnit: 'KJ' }).success).toBe(false);
  });

  it('rejects an unknown unit', () => {
    expect(parse({ weightUnit: 'stone' }).success).toBe(false);
    expect(parse({ distanceUnit: 'furlong' }).success).toBe(false);
  });

  it('still requires at least one field', () => {
    expect(parse({}).success).toBe(false);
  });
});

/**
 * The prototype's own rule, verbatim (ADR-019): lowercase letters, digits, underscores,
 * 3-20 characters. Case-insensitive *uniqueness* is a database constraint (the
 * `profiles_username_unique` partial index) and is not exercised here -- a schema check
 * cannot see other rows, only shape.
 */
describe('updateProfileRequestSchema — username', () => {
  const parse = (body: unknown) => updateProfileRequestSchema.safeParse(body);

  it('accepts a valid username', () => {
    expect(parse({ username: 'jmitch' }).success).toBe(true);
    expect(parse({ username: 'j_mitch_92' }).success).toBe(true);
  });

  it('accepts null, which clears the username', () => {
    expect(parse({ username: null }).success).toBe(true);
  });

  it('rejects uppercase letters', () => {
    expect(parse({ username: 'JMitch' }).success).toBe(false);
  });

  it('rejects fewer than 3 characters', () => {
    expect(parse({ username: 'jm' }).success).toBe(false);
  });

  it('rejects more than 20 characters', () => {
    expect(parse({ username: 'a'.repeat(21) }).success).toBe(false);
  });

  it('rejects characters outside letters, digits and underscore', () => {
    expect(parse({ username: 'j.mitch' }).success).toBe(false);
    expect(parse({ username: 'j mitch' }).success).toBe(false);
    expect(parse({ username: 'j-mitch' }).success).toBe(false);
  });
});
