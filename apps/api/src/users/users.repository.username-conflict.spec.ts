import { ConflictException } from '@nestjs/common';

import { Database } from '../database/database.module';
import { UsersRepository } from './users.repository';

/**
 * A unit test, deliberately not run against real Postgres like `users.repository.spec.ts`.
 * The behaviour under test is "does `updateProfile` recognise *this specific* pg error shape
 * and turn it into a 409 with the exact ADR-019 copy" -- a decision entirely in this file, not
 * in the database. `users.repository.spec.ts` already proves the constraint itself exists and
 * fires against real Postgres; this proves the error-shape-to-exception mapping on top of it,
 * including telling a username collision apart from any other unique violation.
 *
 * drizzle-orm (0.45.2) wraps every node-postgres failure in a `DrizzleQueryError`, with the
 * real pg error -- and its `.code` and `.constraint` -- attached as `.cause`, not as top-level
 * properties. Both shapes are faked below because production code has been bitten by exactly
 * this wrapping before (see the comment on `isUniqueViolation`).
 */
describe('UsersRepository — username uniqueness', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  function fakeDb(rejection: unknown): Database {
    const chain = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockRejectedValue(rejection),
    };
    return { update: jest.fn().mockReturnValue(chain) } as unknown as Database;
  }

  function pgError(constraint: string, wrapped: boolean): unknown {
    const cause = { code: '23505', constraint };
    return wrapped ? { name: 'DrizzleQueryError', cause } : { code: '23505', constraint };
  }

  it('maps a wrapped username unique-violation to a 409 with the ADR-019 copy', async () => {
    const repository = new UsersRepository(fakeDb(pgError('profiles_username_unique', true)));

    await expect(repository.updateProfile(userId, { username: 'jmitch' })).rejects.toThrow(
      ConflictException,
    );
    await expect(
      repository.updateProfile(userId, { username: 'jmitch' }),
    ).rejects.toThrow('That username is taken.');
  });

  it('maps an unwrapped username unique-violation the same way', async () => {
    const repository = new UsersRepository(fakeDb(pgError('profiles_username_unique', false)));

    await expect(repository.updateProfile(userId, { username: 'jmitch' })).rejects.toThrow(
      'That username is taken.',
    );
  });

  /**
   * The mapping is specific to the username constraint. A different unique violation on the
   * same table must not be swallowed into the same misleading message -- and must not become
   * a silent success either, so it is re-thrown as-is for an upstream handler to deal with.
   */
  it('does not relabel a unique violation on a different constraint', async () => {
    const otherError = pgError('some_other_constraint', true);
    const repository = new UsersRepository(fakeDb(otherError));

    await expect(repository.updateProfile(userId, { username: 'jmitch' })).rejects.toBe(
      otherError,
    );
  });

  it('propagates a non-unique-violation error untouched', async () => {
    const genericError = new Error('connection reset');
    const repository = new UsersRepository(fakeDb(genericError));

    await expect(repository.updateProfile(userId, { username: 'jmitch' })).rejects.toBe(
      genericError,
    );
  });
});
