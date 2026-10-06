import { Injectable, Logger } from "@nestjs/common";
import { buildPrPush, detectLiftRecords, sessionLiftBests, type WorkoutSession } from "@forjd/domain";

import { PushNotificationService } from "../notifications/push-notification.service";
import { WorkoutsRepository } from "./workouts.repository";

/**
 * The PR celebration sender for lifts (Phase 12F slice 5a, docs/product/phase-12f-plan.md). After a workout is stored, a
 * lift whose heaviest completed set beats the person's best before it queues one push (`pr:<sessionId>`, so a retried upload
 * is the same push), and the outbox is tried at once. It **never fails the upload**: the workout is already saved, so any
 * problem here is logged, without figures or tokens, and swallowed. A workout uploaded long after it happened (an offline
 * backlog) is dropped by the policy when queueing (`PR_MAX_AGE_MS`). The text carries no weight (ADR-061).
 */
@Injectable()
export class PrCelebrationService {
  private readonly logger = new Logger(PrCelebrationService.name);

  constructor(
    private readonly workouts: WorkoutsRepository,
    private readonly push: PushNotificationService,
  ) {}

  async celebrate(session: WorkoutSession, exerciseNames: ReadonlyMap<string, string>): Promise<void> {
    try {
      if (session.status !== "completed") return;
      const bests = sessionLiftBests(session.exercises);
      if (bests.size === 0) return;

      const exerciseIds = [...bests.keys()];
      const priors = await this.workouts.priorLiftBestsForUser(session.userId, session.id, session.startedAt, exerciseIds);
      const records = detectLiftRecords(
        exerciseIds.map((exerciseId) => ({
          exerciseId,
          exerciseName: exerciseNames.get(exerciseId) ?? "",
          bestKg: bests.get(exerciseId) ?? 0,
          priorBestKg: priors.get(exerciseId) ?? null,
        })),
      );
      const content = buildPrPush({ sessionId: session.id, records });
      if (!content) return;

      const queued = await this.push.enqueue({
        userId: session.userId,
        kind: "pr",
        dedupeKey: `pr:${session.id}`,
        content,
        occurredAt: session.endedAt ?? session.startedAt,
      });
      if (queued.result !== "queued") return;

      // Try to send right away; the drain workflow is the safety net, so a failure here is only logged.
      void this.push.dispatchDue().catch((error: unknown) => this.logFailure("sending", error));
    } catch (error) {
      this.logFailure("celebrating", error);
    }
  }

  private logFailure(step: string, error: unknown): void {
    this.logger.warn(`PR push: ${step} failed (${error instanceof Error ? error.name : "unknown error"}); the workout is saved.`);
  }
}
