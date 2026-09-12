import { User } from "@forjd/domain";

import { AuthenticatedRequest } from "../auth/guards/jwt-auth.guard";

/**
 * A minimal authenticated user + request for controller unit specs (R16 / H11). Deliberately
 * not the same id a test's "other user's resource" fixtures use, so a controller that leaked a
 * client-supplied id into the authenticated-user slot would fail loudly rather than by
 * coincidence matching.
 */
export function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "athlete@example.com",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

export function fakeAuthenticatedRequest(overrides: Partial<User> = {}): AuthenticatedRequest {
  return {
    user: fakeUser(overrides),
    headers: {},
  } as unknown as AuthenticatedRequest;
}
