const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Base64url to bytes, by hand. Deliberately not `atob` or `Buffer`: neither is guaranteed on the
 * phone's JavaScript runtime, and a missing one would fail silently inside `readJwtSubject`'s
 * `catch`, reading every account as signed out (whole-app review 8.5, S1 review).
 */
function base64UrlToBytes(input: string): number[] {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of input.replace(/=+$/, '')) {
    const value = BASE64URL_ALPHABET.indexOf(char);
    if (value === -1) throw new Error('not base64url');
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

/** UTF-8 bytes to a string, via percent-encoding, which every runtime's `decodeURIComponent` reads. */
function utf8BytesToString(bytes: number[]): string {
  return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
}

/**
 * The `sub` claim of a JWT, decoded but **not verified** -- a local label for rows on this device,
 * never an authorisation decision (the server verifies every token it receives). `null` for
 * anything it cannot read, never a guess.
 */
export function readJwtSubject(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(utf8BytesToString(base64UrlToBytes(payload))) as { sub?: unknown };
    return typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : null;
  } catch {
    return null;
  }
}
