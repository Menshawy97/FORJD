import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * The one place this repo makes an HTTP call to WHOOP -- bound separately from
 * `whoop-oauth.service.ts` / the future `WhoopProvider` (7E) so tests substitute a stub,
 * same reasoning as every other `*-client.ts` factory in this codebase (ADR-011: "a
 * provider that constructs its own client is verifiable only by hand against a live
 * vendor"). Endpoints and OAuth grant shapes confirmed against WHOOP's own developer docs
 * during Phase 7 planning (`docs/product/phase-7-plan.md`'s sources list) -- not asserted
 * from memory. The refresh-token request body shape (`client_id`/`client_secret` as form
 * fields, not HTTP Basic auth) is WHOOP's own documented example; the live OAuth round-trip
 * that would fully confirm it against the real API is still owed (see the plan's decision 1).
 */
export const WHOOP_CLIENT = Symbol("WHOOP_CLIENT");

const OAUTH_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE_URL = "https://api.prod.whoop.com/developer";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
/** WHOOP's own collection endpoints cap `limit` at 25 per page. */
const LIST_PAGE_LIMIT = 25;
/** A hard ceiling on pages followed per `list*` call -- protects against an API that (by bug
 *  or malicious response) never returns a null `next_token`, turning a sync into an infinite
 *  loop. 100 pages * 25 records is 2,500 records per call, far beyond one incremental sync's
 *  real volume. */
const MAX_LIST_PAGES = 100;

interface WhoopListResponse {
  records: unknown[];
  next_token: string | null;
}

export interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export interface WhoopClient {
  exchangeAuthorizationCode(code: string, redirectUri: string): Promise<WhoopTokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<WhoopTokenResponse>;
  getRecovery(cycleId: string, accessToken: string): Promise<unknown>;
  getSleep(sleepId: string, accessToken: string): Promise<unknown>;
  getWorkout(workoutId: string, accessToken: string): Promise<unknown>;
  /** WHOOP's own numeric user id -- the value the callback (Phase 7F) stores as
   *  `external_connections.external_user_id`, and the field incoming webhook payloads carry
   *  in `user_id` so an event can be matched back to the right internal user. */
  getProfile(accessToken: string): Promise<{ user_id: number; email: string; first_name: string; last_name: string }>;
  /** `since: null` requests a full sync, mirroring `HealthProvider.sync()`'s own convention. */
  listRecovery(since: Date | null, accessToken: string): Promise<unknown[]>;
  listSleep(since: Date | null, accessToken: string): Promise<unknown[]>;
  listWorkout(since: Date | null, accessToken: string): Promise<unknown[]>;
}

export interface CreateWhoopClientOptions {
  clientId: string;
  clientSecret: string;
  /** Injected for tests; defaults to the global `fetch` Node 22 provides. */
  fetchImpl?: typeof fetch;
}

/**
 * Retries a network error or a 5xx up to `MAX_ATTEMPTS` times with no backoff -- the exact
 * convention `openai-vision.provider.ts` already uses. Deliberately does NOT retry a 4xx:
 * a rejected token or a malformed request is not a transient failure, and retrying it three
 * times only delays surfacing what is actually wrong.
 */
async function requestWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  describeFailure: string,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });

      if (response.ok) {
        return await response.json();
      }

      if (response.status >= 400 && response.status < 500) {
        throw new Error(`WHOOP ${describeFailure} failed with ${response.status}`);
      }

      lastError = new Error(`WHOOP ${describeFailure} failed with ${response.status}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes(`failed with 4`)) {
        throw err;
      }
      lastError = err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `WHOOP ${describeFailure} failed after ${MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export function createWhoopClient(options: CreateWhoopClientOptions): WhoopClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  const requestToken = (params: Record<string, string>): Promise<WhoopTokenResponse> =>
    requestWithRetry(
      fetchImpl,
      OAUTH_TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          ...params,
        }).toString(),
      },
      "token request",
    ) as Promise<WhoopTokenResponse>;

  const getResource = (path: string, accessToken: string): Promise<unknown> =>
    requestWithRetry(
      fetchImpl,
      `${API_BASE_URL}${path}`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
      `GET ${path}`,
    );

  /**
   * Follows `next_token` until WHOOP returns `null`, or `MAX_LIST_PAGES` is reached --
   * accumulating every record across every page into one flat array, since a checkpointed
   * incremental sync (per-metric `sync()` in `WhoopProvider`, Phase 7E) wants "everything
   * since the checkpoint," not one page at a time.
   */
  const listResource = async (path: string, since: Date | null, accessToken: string): Promise<unknown[]> => {
    const records: unknown[] = [];
    let nextToken: string | null = null;

    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const params = new URLSearchParams();
      if (since) params.set("start", since.toISOString());
      params.set("limit", String(LIST_PAGE_LIMIT));
      if (nextToken) params.set("nextToken", nextToken);

      const response = (await requestWithRetry(
        fetchImpl,
        `${API_BASE_URL}${path}?${params.toString()}`,
        { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
        `GET ${path}`,
      )) as WhoopListResponse;

      records.push(...response.records);
      nextToken = response.next_token;
      if (!nextToken) break;
    }

    return records;
  };

  return {
    exchangeAuthorizationCode: (code, redirectUri) =>
      requestToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    refreshAccessToken: (refreshToken) =>
      requestToken({ grant_type: "refresh_token", refresh_token: refreshToken, scope: "offline" }),
    getRecovery: (cycleId, accessToken) => getResource(`/v2/cycle/${cycleId}/recovery`, accessToken),
    getSleep: (sleepId, accessToken) => getResource(`/v2/activity/sleep/${sleepId}`, accessToken),
    getWorkout: (workoutId, accessToken) => getResource(`/v2/activity/workout/${workoutId}`, accessToken),
    getProfile: (accessToken) =>
      getResource("/v2/user/profile/basic", accessToken) as Promise<{
        user_id: number;
        email: string;
        first_name: string;
        last_name: string;
      }>,
    listRecovery: (since, accessToken) => listResource("/v2/recovery", since, accessToken),
    listSleep: (since, accessToken) => listResource("/v2/activity/sleep", since, accessToken),
    listWorkout: (since, accessToken) => listResource("/v2/activity/workout", since, accessToken),
  };
}

export const whoopClientProvider: Provider = {
  provide: WHOOP_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): WhoopClient =>
    createWhoopClient({
      clientId: config.getOrThrow<string>("WHOOP_CLIENT_ID"),
      clientSecret: config.getOrThrow<string>("WHOOP_CLIENT_SECRET"),
    }),
};
