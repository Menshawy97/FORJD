import { Logger, Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * The one place this repo talks to Cloudflare's Turnstile `siteverify` endpoint (ADR-051),
 * bound behind a token so tests substitute a stub -- the same reasoning as every other
 * `*-client.ts` factory here (ADR-011). Business logic depends on the `TurnstileClient`
 * interface, never on Cloudflare's URL or response shape (CLAUDE.md rule 4).
 */
export const TURNSTILE_CLIENT = Symbol("TURNSTILE_CLIENT");

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/**
 * Two attempts of five seconds, not three of ten. The endpoint this guards is public, so every
 * caller can hold a request open for as long as Cloudflare stalls: a 10s worst case, not 30s,
 * bounds that. It also suits Turnstile itself, whose tokens are single-use, so a retry after a
 * lost reply is likely to be refused anyway.
 */
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 5_000;

export interface TurnstileClient {
  /**
   * Whether Cloudflare positively confirms that `token` came from a solved challenge.
   *
   * Resolves `false` -- never throws -- for every case that cannot confirm a human: a rejected
   * token, an empty token, a missing secret, a malformed reply, and Cloudflare being
   * unreachable after retries. The endpoint this guards is public, so failing open would
   * switch the spam protection off exactly when something is wrong. The reason is logged
   * (error codes only, never the secret or the token) so an outage is visible to operators
   * without being distinguishable, by a caller, from a bad token.
   */
  verify(token: string, remoteIp?: string): Promise<boolean>;
}

export interface CreateTurnstileClientOptions {
  secretKey: string;
  /** Injected for tests; defaults to the global `fetch` Node 22 provides. */
  fetchImpl?: typeof fetch;
}

/** Thrown for a 4xx so the retry loop can tell a real rejection from a transient failure. */
class NonRetryableError extends Error {}

/**
 * Retries a network error or a 5xx up to `MAX_ATTEMPTS` times with no backoff -- the
 * convention `whoop-client.ts` and `openai-vision.provider.ts` already use -- and never a
 * 4xx: a rejected request is not transient, and retrying it only delays surfacing it.
 */
async function postWithRetry(fetchImpl: typeof fetch, init: RequestInit): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(SITEVERIFY_URL, { ...init, redirect: "error", signal: controller.signal });

      if (response.ok) {
        return await response.json();
      }

      const failure = new Error(`siteverify failed with ${response.status}`);
      if (response.status >= 400 && response.status < 500) {
        throw new NonRetryableError(failure.message);
      }
      lastError = failure;
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastError = err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `siteverify failed after ${MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** Cloudflare's documented reply; `error-codes` is present on failures. */
function readErrorCodes(body: unknown): string {
  const codes = (body as { "error-codes"?: unknown } | null)?.["error-codes"];
  return Array.isArray(codes) ? codes.filter((c) => typeof c === "string").join(",") : "none";
}

export function createTurnstileClient(options: CreateTurnstileClientOptions): TurnstileClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = new Logger("TurnstileClient");
  let warnedMissingSecret = false;

  return {
    async verify(token, remoteIp) {
      if (!options.secretKey) {
        // Logged once: this is a deployment problem, and one line per sign-up would bury it.
        if (!warnedMissingSecret) {
          warnedMissingSecret = true;
          logger.warn("TURNSTILE_SECRET_KEY is not configured; every sign-up will be refused.");
        }
        return false;
      }
      if (!token.trim()) return false;

      const form = new URLSearchParams({ secret: options.secretKey, response: token });
      if (remoteIp) form.set("remoteip", remoteIp);

      try {
        const body = await postWithRetry(fetchImpl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });

        // Strictly `true`: a string, a number or a missing field must never read as a pass.
        if ((body as { success?: unknown } | null)?.success === true) return true;

        logger.warn(`Turnstile refused a token (error-codes: ${readErrorCodes(body)}).`);
        return false;
      } catch (err) {
        logger.warn(`Turnstile could not be reached; refusing the sign-up (${err instanceof Error ? err.name : "unknown error"}).`);
        return false;
      }
    },
  };
}

export const turnstileClientProvider: Provider = {
  provide: TURNSTILE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): TurnstileClient =>
    createTurnstileClient({
      // Not in the required-env schema on purpose: staging and dev boot before it exists.
      secretKey: config.get<string>("TURNSTILE_SECRET_KEY", ""),
    }),
};
