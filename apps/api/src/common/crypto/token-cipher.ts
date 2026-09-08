import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest -- the first encryption code anywhere in
 * this repo (`docs/product/phase-7-plan.md`, decision 4). No Cloud KMS: the key lives in
 * Google Secret Manager alongside every other secret this API already reads
 * (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`), which is free and needs no network round
 * trip per token read, unlike a KMS decrypt call -- consistent with this project's
 * free-tiers-only constraint (ADR-015).
 *
 * **Key versioning is additive, not a migration.** `EncryptedToken.keyVersion` is stored
 * alongside the ciphertext (the `external_connections` schema's own `token_key_version`
 * column, Phase 7B). Rotating the key means introducing a new version's key while the old
 * key stays configured -- every already-encrypted row keeps decrypting under its own
 * recorded version, and only new writes use the new one. There is exactly one key configured
 * today (`TOKEN_ENCRYPTION_KEY`, version 1); the `keys` map exists so a second key is a
 * config change, not a code change.
 *
 * **Every failure throws, deliberately.** A cipher that returned `null` or an empty string on
 * a bad key or tampered ciphertext would let a corrupted or forged token look like "no
 * connection" rather than "something is wrong" -- the caller (7E's `WhoopProvider`) must be
 * able to tell those apart.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export interface EncryptedToken {
  /** base64url-encoded `iv || ciphertext || authTag`, in that order. */
  ciphertext: string;
  keyVersion: number;
}

export interface EncryptionKeys {
  /** Every key this instance can currently decrypt with, indexed by the version stamped on
   *  the ciphertext at the time it was encrypted. */
  keys: Record<number, Buffer>;
}

export interface EncryptTokenOptions extends EncryptionKeys {
  /** Which entry in `keys` new ciphertext is stamped with. Older versions stay in `keys`
   *  purely to keep decrypting rows written before a rotation. */
  currentVersion: number;
}

export class InvalidTokenCiphertextError extends Error {
  constructor() {
    super("Token ciphertext failed to decrypt -- wrong key, tampered data, or malformed input.");
    this.name = "InvalidTokenCiphertextError";
  }
}

export class UnknownKeyVersionError extends Error {
  constructor(keyVersion: number) {
    super(`No encryption key is configured for key version ${keyVersion}.`);
    this.name = "UnknownKeyVersionError";
  }
}

function requireKeyLength(key: Buffer): void {
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`Token encryption key must be ${KEY_LENGTH_BYTES} bytes, got ${key.length}.`);
  }
}

export function encryptToken(plaintext: string, options: EncryptTokenOptions): EncryptedToken {
  const key = options.keys[options.currentVersion];
  if (!key) {
    throw new UnknownKeyVersionError(options.currentVersion);
  }
  requireKeyLength(key);

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: Buffer.concat([iv, ciphertext, authTag]).toString("base64url"),
    keyVersion: options.currentVersion,
  };
}

export function decryptToken(encrypted: EncryptedToken, options: EncryptionKeys): string {
  const key = options.keys[encrypted.keyVersion];
  if (!key) {
    throw new UnknownKeyVersionError(encrypted.keyVersion);
  }
  requireKeyLength(key);

  // Buffer.from is lenient about invalid base64url -- like `exercise-cursor.ts`'s decoder, it
  // drops what it cannot read rather than throwing, so the real validation is the length
  // check below plus GCM's own authentication tag, not this call.
  const raw = Buffer.from(encrypted.ciphertext, "base64url");

  const minimumLength = IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;
  if (raw.length < minimumLength) {
    throw new InvalidTokenCiphertextError();
  }

  const iv = raw.subarray(0, IV_LENGTH_BYTES);
  const authTag = raw.subarray(raw.length - AUTH_TAG_LENGTH_BYTES);
  const ciphertext = raw.subarray(IV_LENGTH_BYTES, raw.length - AUTH_TAG_LENGTH_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // node:crypto throws a generic "Unsupported state or unable to authenticate data" for
    // both a wrong key and a tampered auth tag -- there is no safe way to tell them apart,
    // and the caller should not be able to either (that distinction is exactly what an
    // attacker probing for a working key would want to learn).
    throw new InvalidTokenCiphertextError();
  }
}
