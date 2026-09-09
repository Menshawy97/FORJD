import { Inject, Injectable } from "@nestjs/common";
import type { SyncedObservation } from "@forjd/domain";

import { WhoopConnectionRepository } from "./whoop-connection.repository";
import { WHOOP_CLIENT, type WhoopClient } from "./whoop-client";
import { WhoopOAuthService } from "./whoop-oauth.service";
import { ensureUsableWhoopAccessToken } from "./whoop-token-access";
import { mapRecoveryToObservations, mapSleepToObservations, mapWorkoutToObservations } from "./whoop-record-mapping";
import { TOKEN_CIPHER, type TokenCipher } from "../../common/crypto/token-cipher.provider";
import { HealthDataRepository } from "../../health-data/health-data.repository";

/** WHOOP's own documented webhook payload -- an event notification, not the data itself
 *  (`docs/product/phase-7-plan.md` decision B): only an id, which must be fetched. */
export interface WhoopWebhookEvent {
  user_id: number;
  id: string;
  type: string;
  trace_id: string;
}

/**
 * One webhook event, end to end: verify the connection exists, fetch the single named
 * record, map it, ingest it -- and return, per decision B's synchronous design (Cloud Run
 * has no queue infrastructure; WHOOP's own 5-retries-over-an-hour is the safety net for
 * anything this call fails to complete). Deliberately bypasses the `HealthProvider`
 * interface: a webhook names one exact record, not "sync since a checkpoint," so it goes
 * straight to `WhoopClient` + `whoop-record-mapping.ts`, the same pieces `WhoopProvider`
 * itself is built from.
 *
 * `*.deleted` events are acknowledged (2XX, so WHOOP does not retry) but do not remove
 * anything -- `health_observations` has no delete path built for any provider yet. Recorded
 * as a known, deliberate gap rather than silently pretended-away; see ADR-037.
 */
@Injectable()
export class WhoopWebhookService {
  constructor(
    private readonly connections: WhoopConnectionRepository,
    private readonly oauth: WhoopOAuthService,
    @Inject(WHOOP_CLIENT) private readonly client: WhoopClient,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
    private readonly healthData: HealthDataRepository,
  ) {}

  async processEvent(event: WhoopWebhookEvent): Promise<void> {
    if (event.type.endsWith(".deleted")) {
      return;
    }

    const connection = await this.connections.findByExternalUserId(String(event.user_id));
    if (!connection) {
      // A webhook for a WHOOP account this API has never connected (or has since
      // disconnected) -- nothing to do, and not an error on WHOOP's side or ours.
      return;
    }

    const accessToken = await ensureUsableWhoopAccessToken(connection.userId, this.connections, this.oauth, this.cipher);
    const observations = await this.fetchAndMap(event, accessToken);

    if (observations.length > 0) {
      await this.healthData.ingestObservations(
        connection.userId,
        observations.map((o) => ({ ...o, source: "whoop" as const })),
      );
    }
  }

  private async fetchAndMap(event: WhoopWebhookEvent, accessToken: string): Promise<SyncedObservation[]> {
    if (event.type.startsWith("recovery.")) {
      const recovery = await this.client.getRecovery(event.id, accessToken);
      return mapRecoveryToObservations(recovery as never);
    }
    if (event.type.startsWith("sleep.")) {
      const sleep = await this.client.getSleep(event.id, accessToken);
      return mapSleepToObservations(sleep as never);
    }
    if (event.type.startsWith("workout.")) {
      const workout = await this.client.getWorkout(event.id, accessToken);
      return mapWorkoutToObservations(workout as never);
    }
    return [];
  }
}
