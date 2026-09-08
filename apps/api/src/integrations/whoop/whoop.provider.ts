import type { HealthMetricType, HealthPermission, HealthProvider, PermissionResult, ProviderCapabilities, SyncedObservation, SyncRequest, SyncResult } from "@forjd/domain";

import { WhoopConnectionRepository, WhoopConnectionRow } from "./whoop-connection.repository";
import type { WhoopClient } from "./whoop-client";
import type { WhoopOAuthService } from "./whoop-oauth.service";
import { mapRecoveryToObservations, mapSleepToObservations, mapWorkoutToObservations } from "./whoop-record-mapping";
import type { TokenCipher } from "../../common/crypto/token-cipher.provider";

const RECOVERY_METRICS: readonly HealthMetricType[] = ["hrv", "resting_heart_rate"];
const SLEEP_METRICS: readonly HealthMetricType[] = [
  "sleep_duration",
  "sleep_light_duration",
  "sleep_deep_duration",
  "sleep_rem_duration",
  "sleep_awake_duration",
  "respiratory_rate",
];
const WORKOUT_METRICS: readonly HealthMetricType[] = ["active_energy"];

/** Everything `whoop-record-mapping.ts` can actually produce -- WHOOP's own recovery, sleep,
 *  and workout endpoints, and nothing this integration does not fetch (no weight, no steps,
 *  no VO2 max: WHOOP's API has no endpoints for those). */
const WHOOP_SUPPORTED_METRICS: readonly HealthMetricType[] = [...RECOVERY_METRICS, ...SLEEP_METRICS, ...WORKOUT_METRICS];

/** Which OAuth scope a canonical metric depends on -- used to turn the connection's stored,
 *  actually-granted `scopes` string into a `PermissionResult`, since WHOOP has no runtime
 *  per-metric permission API the way Health Connect does (scopes are only ever granted once,
 *  during the browser consent screen). */
const SCOPE_FOR_METRIC: Partial<Record<HealthMetricType, string>> = Object.fromEntries([
  ...RECOVERY_METRICS.map((m) => [m, "read:recovery"]),
  ...SLEEP_METRICS.map((m) => [m, "read:sleep"]),
  ...WORKOUT_METRICS.map((m) => [m, "read:workout"]),
]);

/** Refresh this early relative to actual expiry -- a request already in flight when the
 *  token expires mid-call is worse than refreshing a minute before it strictly needs to. */
const REFRESH_SKEW_MS = 60_000;

/**
 * The second concrete `HealthProvider` implementation (`HealthConnectProvider`, Phase 6F,
 * was the first) -- constructed per-user, per `docs/product/phase-7-plan.md` slice 7E.
 * Unlike Health Connect, which is an on-device capability check, WHOOP is a stored OAuth
 * connection: `connect()`'s job is to ensure that connection's access token is usable,
 * refreshing it if it is at or near expiry, not to establish the connection itself (that is
 * the authorize/callback round trip, Phase 7F).
 */
export class WhoopProvider implements HealthProvider {
  readonly source = "whoop" as const;

  constructor(
    private readonly userId: string,
    private readonly connections: WhoopConnectionRepository,
    private readonly oauth: WhoopOAuthService,
    private readonly client: WhoopClient,
    private readonly cipher: TokenCipher,
  ) {}

  async connect(): Promise<void> {
    await this.ensureUsableAccessToken();
  }

  async disconnect(): Promise<void> {
    await this.connections.updateStatus(this.userId, "disconnected");
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return { source: this.source, supportedMetrics: WHOOP_SUPPORTED_METRICS };
  }

  async requestPermissions(permissions: readonly HealthPermission[]): Promise<PermissionResult> {
    const row = await this.connections.findByUserId(this.userId);
    const grantedScopes = new Set((row?.scopes ?? "").split(" ").filter(Boolean));

    const granted: HealthPermission[] = [];
    const denied: HealthPermission[] = [];
    for (const permission of permissions) {
      const requiredScope = SCOPE_FOR_METRIC[permission];
      const isGranted = Boolean(requiredScope) && grantedScopes.has(requiredScope!);
      (isGranted ? granted : denied).push(permission);
    }

    return { granted, denied };
  }

  async sync(request: SyncRequest): Promise<SyncResult> {
    const accessToken = await this.ensureUsableAccessToken();
    const wants = (metrics: readonly HealthMetricType[]) => request.metricTypes.some((m) => metrics.includes(m));

    const observations: SyncedObservation[] = [];

    if (wants(RECOVERY_METRICS)) {
      const recoveries = await this.client.listRecovery(request.since, accessToken);
      for (const recovery of recoveries) observations.push(...mapRecoveryToObservations(recovery as never));
    }
    if (wants(SLEEP_METRICS)) {
      const sleeps = await this.client.listSleep(request.since, accessToken);
      for (const sleep of sleeps) observations.push(...mapSleepToObservations(sleep as never));
    }
    if (wants(WORKOUT_METRICS)) {
      const workouts = await this.client.listWorkout(request.since, accessToken);
      for (const workout of workouts) observations.push(...mapWorkoutToObservations(workout as never));
    }

    return {
      observations: observations.filter((o) => request.metricTypes.includes(o.metricType)),
      syncedAt: new Date(),
    };
  }

  /**
   * Returns a usable, decrypted access token -- refreshing and persisting a new one first if
   * the stored token is at or near expiry. Throws if there is no connection at all (nothing
   * for `connect()`/`sync()` to work with -- the authorize/callback round trip, Phase 7F, is
   * what creates one) or if a refresh attempt itself fails, marking the connection `expired`
   * in the latter case so `requestPermissions()`/a future "reconnect" UI can see it.
   */
  private async ensureUsableAccessToken(): Promise<string> {
    const row = await this.connections.findByUserId(this.userId);
    if (!row) {
      throw new Error(`WHOOP is not connected for user ${this.userId}.`);
    }

    const isFresh = row.expiresAt !== null && row.expiresAt.getTime() - REFRESH_SKEW_MS > Date.now();
    if (isFresh) {
      return this.cipher.decrypt({ ciphertext: row.encryptedAccessToken, keyVersion: row.tokenKeyVersion });
    }

    return this.refreshAndPersist(row);
  }

  private async refreshAndPersist(row: WhoopConnectionRow): Promise<string> {
    if (!row.encryptedRefreshToken) {
      // No refresh token was ever stored (the `offline` scope was never granted, or it
      // predates this integration existing) -- there is nothing to refresh with, and
      // decrypting an empty string would only produce a confusing failure further down.
      await this.connections.updateStatus(this.userId, "expired");
      throw new Error(`WHOOP connection for user ${this.userId} has no refresh token to renew its access token with.`);
    }
    const refreshToken = this.cipher.decrypt({ ciphertext: row.encryptedRefreshToken, keyVersion: row.tokenKeyVersion });

    let tokens;
    try {
      tokens = await this.oauth.refresh(refreshToken);
    } catch (err) {
      await this.connections.updateStatus(this.userId, "expired");
      throw err;
    }

    const encryptedAccess = this.cipher.encrypt(tokens.access_token);
    const encryptedRefresh = this.cipher.encrypt(tokens.refresh_token);

    await this.connections.upsertTokens(this.userId, {
      status: "connected",
      externalUserId: row.externalUserId,
      encryptedAccessToken: encryptedAccess.ciphertext,
      encryptedRefreshToken: encryptedRefresh.ciphertext,
      tokenKeyVersion: encryptedAccess.keyVersion,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope,
    });

    return tokens.access_token;
  }
}
