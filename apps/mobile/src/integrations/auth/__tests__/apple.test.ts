// ADR-041. The Apple adapter. Apple binds its ID token to a nonce: the SHA-256 of a random value
// goes to Apple, and the raw value goes to our API, which hands it to Supabase to verify. The
// SDK and the crypto module are mocked at their boundaries; what is proven is that hash/raw
// pairing, and the mapping of every outcome to a result the app understands.
const mockSignInAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
  signInAsync: (...args: unknown[]) => mockSignInAsync(...args),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])),
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `sha256(${value})`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import { signInWithApple } from '../apple';

describe('Apple adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAvailableAsync.mockResolvedValue(true);
  });

  it('asks Apple with the hash of the nonce and returns the token with the raw nonce', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'apple-identity-token' });

    const result = await signInWithApple();

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.idToken).toBe('apple-identity-token');
    expect(result.nonce).toBe('0102030405060708090a0b0c0d0e0f10');
    expect(mockSignInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'sha256(0102030405060708090a0b0c0d0e0f10)' }),
    );
  });

  it('never sends the raw nonce to Apple, only its hash', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'apple-identity-token' });

    await signInWithApple();

    const sent = (mockSignInAsync.mock.calls[0]![0] as { nonce: string }).nonce;
    expect(sent).not.toBe('0102030405060708090a0b0c0d0e0f10');
  });

  it('reports a person dismissing the sheet as cancelled', async () => {
    mockSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });

    await expect(signInWithApple()).resolves.toEqual({ status: 'cancelled' });
  });

  it('reports a missing identity token as a failure', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: null });

    await expect(signInWithApple()).resolves.toEqual({ status: 'failed' });
  });

  it('reports any other error as a failure', async () => {
    mockSignInAsync.mockRejectedValue(new Error('boom'));

    await expect(signInWithApple()).resolves.toEqual({ status: 'failed' });
  });

  it('reports unavailable where Sign in with Apple is not supported (Android, Expo Go)', async () => {
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(signInWithApple()).resolves.toEqual({ status: 'unavailable' });
    expect(mockSignInAsync).not.toHaveBeenCalled();
  });
});
