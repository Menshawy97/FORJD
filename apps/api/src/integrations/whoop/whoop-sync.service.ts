import { Injectable } from "@nestjs/common";

import { WhoopConnectionRepository } from "./whoop-connection.repository";
import { WhoopProviderFactory } from "./whoop-provider.factory";
import { HealthDataRepository } from "../../health-data/health-data.repository";

export interface WhoopSyncResult {
  observationCount: number;
}

/**
 * The "sync orchestrator" `health-provider.ts`'s own docblock names as not yet built,
 * built here for WHOOP specifically -- backs `POST /integrations/whoop/sync` (Phase 7F),
 * the manual-sync backstop `docs/product/phase-7-plan.md` decision B names for anything a
 * webhook delivery genuinely misses.
 *
 * Asks the provider what it supports (`getCapabilities()`) rather than hardcoding a metric
 * list, so a future change to what `WhoopProvider` can supply needs no change here.
 */
@Injectable()
export class WhoopSyncService {
  constructor(
    private readonly connections: WhoopConnectionRepository,
    private readonly healthData: HealthDataRepository,
    private readonly providerFactory: WhoopProviderFactory,
  ) {}

  async syncUser(userId: string): Promise<WhoopSyncResult> {
    const connection = await this.connections.findByUserId(userId);
    if (!connection) {
      throw new Error(`WHOOP is not connected for user ${userId}.`);
    }

    const provider = this.providerFactory.forUser(userId);
    const capabilities = await provider.getCapabilities();
    const result = await provider.sync({ metricTypes: capabilities.supportedMetrics, since: connection.lastSyncAt });

    if (result.observations.length > 0) {
      await this.healthData.ingestObservations(
        userId,
        result.observations.map((o) => ({ ...o, source: "whoop" as const })),
      );
    }

    await this.connections.updateLastSyncAt(userId, result.syncedAt);

    return { observationCount: result.observations.length };
  }
}
