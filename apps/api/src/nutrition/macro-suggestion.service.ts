import { Injectable } from "@nestjs/common";
import type { MacroGoalSuggestionResponse } from "@forjd/contracts";
import type { User } from "@forjd/domain";

import { BodyRepository } from "../body/body.repository";
import { HealthDataRepository } from "../health-data/health-data.repository";
import { UsersRepository } from "../users/users.repository";
import { buildMacroGoalSuggestion } from "./macro-suggestion";

/** A year of health-data weights is plenty to find the newest one; the read stays bounded (R8). */
const WEIGHT_LOOKBACK_DAYS = 365;
const WEIGHT_READ_LIMIT = 1000;

/**
 * Gathers what `buildMacroGoalSuggestion` needs for one user: their profile, their InBody scans and
 * their health-data weights (docs/product/scan-height-age-plan.md §4.5). Its own service, so the
 * nutrition service keeps its single dependency.
 */
@Injectable()
export class MacroSuggestionService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly bodyRepository: BodyRepository,
    private readonly healthDataRepository: HealthDataRepository,
  ) {}

  async getSuggestion(viewer: User, today: Date = new Date()): Promise<MacroGoalSuggestionResponse> {
    const since = new Date(today.getTime() - WEIGHT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const [profile, scans, weights] = await Promise.all([
      this.usersRepository.findProfile(viewer.id),
      this.bodyRepository.listScansForUser(viewer.id),
      this.healthDataRepository.getObservationsForUser(viewer.id, {
        metricTypes: ["weight"],
        since,
        limit: WEIGHT_READ_LIMIT,
      }),
    ]);
    return buildMacroGoalSuggestion({
      profile,
      scans,
      healthWeights: weights.filter((w) => w.unit === "kg").map((w) => ({ at: w.startTime, kg: w.value })),
      today,
    });
  }
}
