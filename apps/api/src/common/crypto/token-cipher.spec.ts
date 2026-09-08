import { decryptToken, encryptToken, InvalidTokenCiphertextError, UnknownKeyVersionError } from "./token-cipher";

/**
 * `TokenCipher` is the first encryption code anywhere in this repo (Phase 7 plan, decision 4) --
 * there is no house pattern to mirror, so this spec is deliberately paranoid: a wrong key, a
 * flipped bit, or a truncated ciphertext must all fail loudly rather than return garbage that
 * looks like a plausible OAuth token.
 */
describe("token cipher", () => {
  const key = Buffer.alloc(32, 7);
  const otherKey = Buffer.alloc(32, 9);
  const keys = { 1: key };

  it("round-trips a plaintext token", () => {
    const encrypted = encryptToken("a-real-looking-access-token", { currentVersion: 1, keys });

    expect(decryptToken(encrypted, { keys })).toBe("a-real-looking-access-token");
  });

  it("round-trips an empty string", () => {
    const encrypted = encryptToken("", { currentVersion: 1, keys });

    expect(decryptToken(encrypted, { keys })).toBe("");
  });

  it("round-trips a long, high-entropy token", () => {
    const token = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)).toString("base64url");
    const encrypted = encryptToken(token, { currentVersion: 1, keys });

    expect(decryptToken(encrypted, { keys })).toBe(token);
  });

  it("stamps the ciphertext with the current key version", () => {
    const encrypted = encryptToken("token", { currentVersion: 1, keys });

    expect(encrypted.keyVersion).toBe(1);
  });

  it("produces a different ciphertext for the same plaintext on every call", () => {
    // A fresh random IV per encryption is what makes GCM safe to reuse a key with -- two
    // identical ciphertexts for the same plaintext would mean the IV was not actually random.
    const first = encryptToken("token", { currentVersion: 1, keys });
    const second = encryptToken("token", { currentVersion: 1, keys });

    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects ciphertext decrypted with the wrong key", () => {
    const encrypted = encryptToken("token", { currentVersion: 1, keys });

    expect(() => decryptToken(encrypted, { keys: { 1: otherKey } })).toThrow(InvalidTokenCiphertextError);
  });

  it("rejects ciphertext whose authentication tag was tampered with", () => {
    const encrypted = encryptToken("token", { currentVersion: 1, keys });
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -2) + "AA" };

    expect(() => decryptToken(tampered, { keys })).toThrow(InvalidTokenCiphertextError);
  });

  it("rejects a truncated ciphertext", () => {
    const encrypted = encryptToken("token", { currentVersion: 1, keys });
    const truncated = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, 10) };

    expect(() => decryptToken(truncated, { keys })).toThrow(InvalidTokenCiphertextError);
  });

  it("rejects ciphertext that is not valid base64url at all", () => {
    const encrypted = encryptToken("token", { currentVersion: 1, keys });
    const malformed = { ...encrypted, ciphertext: "not valid base64url!! %%" };

    expect(() => decryptToken(malformed, { keys })).toThrow(InvalidTokenCiphertextError);
  });

  it("rejects a key version no configured key can serve, when decrypting", () => {
    const encrypted = encryptToken("token", { currentVersion: 1, keys });

    expect(() => decryptToken({ ...encrypted, keyVersion: 2 }, { keys })).toThrow(UnknownKeyVersionError);
  });

  it("rejects a current version no configured key can serve, when encrypting", () => {
    expect(() => encryptToken("token", { currentVersion: 2, keys })).toThrow(UnknownKeyVersionError);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => encryptToken("token", { currentVersion: 1, keys: { 1: Buffer.alloc(16) } })).toThrow(
      /32 bytes/,
    );
  });

  it("decrypts with an older key version once the current version has rotated forward", () => {
    // Rotation must be additive: encrypting with version 1 today must still decrypt once
    // TOKEN_ENCRYPTION_KEY_VERSION moves to 2, as long as the old key is still configured.
    const encrypted = encryptToken("token", { currentVersion: 1, keys: { 1: key } });

    expect(decryptToken(encrypted, { keys: { 1: key, 2: otherKey } })).toBe("token");
  });
});
