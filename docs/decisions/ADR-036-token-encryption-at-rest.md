# ADR-036: OAuth token encryption at rest — AES-256-GCM in application code

**Status:** Accepted
**Date:** 2026-09-08

## Context

Phase 7 (WHOOP) is the first integration to store a third-party OAuth access/refresh token,
in the `external_connections` table (Phase 7B). `docs/architecture/security.md:17` has always
listed "token encryption for `ExternalConnection` records" as a baseline requirement, but no
cipher, key source, or rotation policy was ever specified — and no encryption code of any kind
exists anywhere in this repository today. Phase 7 is establishing this precedent from nothing,
not following one.

Two real options exist for where the encryption itself happens: encrypt in application code
with a key the API holds, or delegate to Google Cloud KMS (envelope encryption, key material
never leaves Google's HSM). This project runs on free tiers only (ADR-015) and already
declined paid Redis and paid Railway on cost grounds; Cloud KMS bills per key-version per
month plus per encrypt/decrypt operation, and every token read (which happens on essentially
every outbound WHOOP call, per decision C in `phase-7-plan.md`) would become a network round
trip to a separate Google service.

## Decision

1. **AES-256-GCM, performed in application code (`node:crypto`), not Cloud KMS.** GCM is an
   authenticated mode — decryption fails loudly on any tampering or wrong key, which matters
   for a value that grants read access to a person's health data. No new dependency: Node's
   built-in `crypto` module suffices.
2. **The key lives in Google Secret Manager**, exactly where `SUPABASE_SERVICE_ROLE_KEY` and
   `OPENAI_API_KEY` already live for deployed environments (`docs/product/roadmap.md`'s Cloud
   Run secrets section), read via the same `ConfigService` + `getOrThrow` factory pattern every
   existing third-party client uses (`openai-vision-client.ts`, `nvidia-vision-client.ts`).
   `TOKEN_ENCRYPTION_KEY`: base64-encoded, exactly 32 raw bytes.
3. **Every encrypted value is stamped with a key version**, stored as its own column
   (`external_connections.token_key_version`, Phase 7B) rather than folded into the ciphertext
   in a way that couples storage format to key management. A future key rotation introduces a
   second key while the old one stays configured — every row already encrypted keeps
   decrypting under its own recorded version, and only new writes pick up the new one. This
   is additive: no re-encryption migration, no downtime, no code change to the cipher itself.
4. **Every failure mode throws**, and a wrong key and a tampered ciphertext throw the *same*
   `InvalidTokenCiphertextError` rather than two distinguishable errors — `node:crypto` itself
   cannot tell them apart for GCM, and if it could, an attacker probing for a working key is
   exactly the audience that distinction would help.
5. **Implementation:** `apps/api/src/common/crypto/token-cipher.ts` (pure functions,
   100%-covered per the per-file coverage list), `token-cipher.provider.ts` (the injectable
   `TOKEN_CIPHER` wired via `ConfigService`, mirroring the third-party client factory pattern).

## Consequences

- The API now has exactly one place tokens are encrypted or decrypted; any future integration
  that needs to store a secret at rest (a second OAuth provider, an API key a user supplies)
  reuses this module rather than inventing its own scheme.
- `TOKEN_ENCRYPTION_KEY` becomes a required boot-time secret the moment any module actually
  injects `TOKEN_CIPHER` (Phase 7D onward) — like `OPENAI_API_KEY`, the API will fail to start
  without it once that wiring lands, not before.
- If Google Cloud KMS is ever revisited (e.g. a compliance requirement this project does not
  have today), only `token-cipher.provider.ts`'s factory needs to change — `token-cipher.ts`'s
  pure functions and every caller of `TOKEN_CIPHER` stay untouched, because the interface is
  "encrypt a string, decrypt a string," not "here is how AES-GCM works."
- Key rotation procedure (manual, infrequent): generate a new 32-byte key, add it to the
  `keys` map in `token-cipher.provider.ts` under a new version number, set
  `TOKEN_ENCRYPTION_KEY_VERSION` to that version so new writes use it, and leave the old key
  configured until every row stamped with the old version has been re-encrypted or expired
  naturally (WHOOP tokens expire on their own schedule regardless).

## Related

- [`../architecture/security.md`](../architecture/security.md)
- [`../architecture/integrations.md`](../architecture/integrations.md)
- [`../decisions/ADR-015-supabase-topology-and-free-host.md`](../decisions/ADR-015-supabase-topology-and-free-host.md)
- [`../product/phase-7-plan.md`](../product/phase-7-plan.md)
