// Emulator walk 2026-10-14, finding 16. Push registration identifies the signed-in account through
// `defaultPushDeps.getUserId`. It used to read the stored `userId`, which no sign-in path ever saves
// (`saveSession` is called without an identity in login, sign-up, refresh and social sign-in), so it was
// always null, registration returned 'unavailable', and no phone ever registered for push. The account
// comes from the access token instead, the way the upload queue already reads it (`getAccountId`).
jest.mock('@/auth/secureStorage', () => ({
  getAccountId: jest.fn(async () => 'account-from-token'),
  getUserId: jest.fn(async () => null),
}));

import { defaultPushDeps } from '../push-registration';

describe('defaultPushDeps', () => {
  it('names the signed-in account from the access token, which every sign-in saves', async () => {
    await expect(defaultPushDeps.getUserId()).resolves.toBe('account-from-token');
  });
});
