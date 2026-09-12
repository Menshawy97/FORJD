import { Injectable } from '@nestjs/common';
import type {
  AccountExportConnection,
  AccountExportPrograms,
  AccountExportResponse,
  BodyScanResponse,
  HealthObservationResponse,
  NutritionLogEntryResponse,
  PrivacySettingsResponse,
  ProfileResponse,
  ProgramEnrollment,
  ProgramSummary,
  WorkoutBlockResponse,
  WorkoutExerciseResponse,
  WorkoutSessionExerciseResponse,
  WorkoutSessionResponse,
  WorkoutSetResponse,
  WorkoutTemplateResponse,
} from '@forjd/contracts';
import type {
  BodyMetric,
  PrivacySettings,
  Profile,
  ScanSource,
  SegmentalSite,
  WorkoutBlock,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSet,
  WorkoutTemplate,
} from '@forjd/domain';

import { BodyRepository } from '../body/body.repository';
import { HealthDataRepository } from '../health-data/health-data.repository';
import { WhoopConnectionRepository } from '../integrations/whoop/whoop-connection.repository';
import { NutritionLogEntry, NutritionRepository } from '../nutrition/nutrition.repository';
import { PrivacyService } from '../privacy/privacy.service';
import { ProgramsRepository } from '../programs/programs.repository';
import { SubscriptionService } from '../subscription/subscription.service';
import { UsersRepository } from './users.repository';
import { WorkoutsRepository } from '../workouts/workouts.repository';

/**
 * R4 (H2) -- GDPR Art. 15 & 20. `GET /users/me` returns profile and privacy only; there was no
 * way for an athlete to get a full copy of everything else FORJD holds about them. This service
 * is that copy: one read across every table `AccountDeletionService`'s own orphan check (R3,
 * C1) also walks, assembled into the single `accountExportSchema` shape.
 *
 * **Every method call here is scoped to the requesting `userId`.** There is no path in this
 * class that can read another user's row -- every repository call below takes `userId` as an
 * explicit argument, the same discipline `AccountDeletionService` holds for deletion.
 *
 * **Mapping duplication is deliberate, not an oversight.** `UsersService.toProfileResponse` /
 * `toPrivacyResponse`, `WorkoutsService.toDetail`, `WorkoutSessionsService.toDetail`, and
 * `ProgramsService`'s own mappers are all `private` methods on services this module does not
 * import (importing them would mean exporting request-path services purely so an export job
 * could call them, which is a bigger seam than a handful of already-trivial 1:1 field copies).
 * Each mapper here is a direct, field-for-field mirror of its service counterpart, named the
 * same way, so a reviewer comparing the two sees the duplication is exact rather than drifted.
 */
@Injectable()
export class AccountExportService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly privacyService: PrivacyService,
    private readonly subscriptionService: SubscriptionService,
    private readonly healthDataRepository: HealthDataRepository,
    private readonly bodyRepository: BodyRepository,
    private readonly nutritionRepository: NutritionRepository,
    private readonly workoutsRepository: WorkoutsRepository,
    private readonly programsRepository: ProgramsRepository,
    private readonly whoopConnections: WhoopConnectionRepository,
  ) {}

  async exportAccount(userId: string, email: string): Promise<AccountExportResponse> {
    const [
      profile,
      privacy,
      plan,
      observations,
      scans,
      nutritionEntries,
      workoutTemplates,
      workoutSessions,
      ownedPrograms,
      enrollment,
      whoopConnection,
    ] = await Promise.all([
      this.usersRepository.findProfile(userId),
      this.privacyService.get(userId),
      this.subscriptionService.getPlan(userId),
      this.healthDataRepository.getAllObservationsForExport(userId),
      this.bodyRepository.listScansForUser(userId),
      this.nutritionRepository.listAllForUserForExport(userId),
      this.exportWorkoutTemplates(userId),
      this.exportWorkoutSessions(userId),
      this.programsRepository.listForUser({ userId, scope: 'mine' }),
      this.programsRepository.findActiveEnrollment(userId),
      this.whoopConnections.findByUserId(userId),
    ]);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      account: { id: userId, email },
      profile: profile ? this.toProfileResponse(profile, plan) : null,
      privacy: this.toPrivacyResponse(privacy),
      healthObservations: observations.map((observation) => this.toHealthObservationResponse(observation)),
      bodyScans: scans.map((scan) => this.toBodyScanResponse(scan)),
      nutritionLogEntries: nutritionEntries.map((entry) => this.toNutritionLogEntryResponse(entry)),
      workoutTemplates,
      workoutSessions,
      programs: this.toProgramsResponse(ownedPrograms, enrollment),
      externalConnections: whoopConnection ? [this.toConnectionResponse(whoopConnection)] : [],
    };
  }

  // -----------------------------------------------------------------------------------------
  // Workouts -- no bulk "every template/session in full" read exists on `WorkoutsRepository`
  // (only paginated summaries), so this lists owned ids first and reads each one's full tree
  // through the same `findByIdForUser`/`findSessionByIdForUser` the live detail endpoints use.
  // -----------------------------------------------------------------------------------------

  private async exportWorkoutTemplates(userId: string): Promise<WorkoutTemplateResponse[]> {
    const ids = await this.workoutsRepository.listOwnTemplateIdsForUser(userId);
    const templates = await Promise.all(ids.map((id) => this.workoutsRepository.findByIdForUser(id, userId)));
    return templates
      .filter((template): template is WorkoutTemplate => template !== null)
      .map((template) => this.toWorkoutTemplateResponse(template));
  }

  private async exportWorkoutSessions(userId: string): Promise<WorkoutSessionResponse[]> {
    const ids = await this.workoutsRepository.listSessionIdsForUser(userId);
    const sessions = await Promise.all(ids.map((id) => this.workoutsRepository.findSessionByIdForUser(id, userId)));
    return sessions
      .filter((session): session is WorkoutSession => session !== null)
      .map((session) => this.toWorkoutSessionResponse(session));
  }

  // -----------------------------------------------------------------------------------------
  // Mappers -- each one mirrors an existing service's private mapper field-for-field. See this
  // class's own docblock for why they are duplicated here rather than reached through injection.
  // -----------------------------------------------------------------------------------------

  private toProfileResponse(profile: Profile, plan: ProfileResponse['plan']): ProfileResponse {
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      username: profile.username,
      dateOfBirth: profile.dateOfBirth,
      sex: profile.sex,
      heightCm: profile.heightCm,
      unitSystem: profile.unitSystem,
      weightUnit: profile.weightUnit,
      distanceUnit: profile.distanceUnit,
      energyUnit: profile.energyUnit,
      trainingGoals: profile.trainingGoals,
      activities: profile.activities,
      city: profile.city,
      avatarUrl: profile.avatarUrl,
      plan,
    };
  }

  private toPrivacyResponse(settings: PrivacySettings): PrivacySettingsResponse {
    return {
      publicProfile: settings.publicProfile,
      leaderboardOptIn: settings.leaderboardOptIn,
      locationForLeaderboard: settings.locationForLeaderboard,
      aiFeaturesConsent: settings.aiFeaturesConsent,
      aiFeaturesConsentAt: settings.aiFeaturesConsentAt?.toISOString() ?? null,
      crashDiagnostics: settings.crashDiagnostics,
    };
  }

  /**
   * Rule 10 -- `source` rides through untouched from the row `HealthDataRepository` read. This
   * export never resolves by source priority the way a series read does: it is a copy of every
   * observation FORJD stored, from every provider, not the one winning reading per time window.
   */
  private toHealthObservationResponse(observation: {
    metricType: string;
    value: number;
    unit: string;
    startTime: Date;
    endTime: Date;
    source: string;
  }): HealthObservationResponse {
    return {
      metricType: observation.metricType as HealthObservationResponse['metricType'],
      value: observation.value,
      unit: observation.unit,
      startTime: observation.startTime.toISOString(),
      endTime: observation.endTime.toISOString(),
      source: observation.source as HealthObservationResponse['source'],
    };
  }

  private toBodyScanResponse(scan: {
    id: string;
    measuredAt: Date;
    source: string;
    measurements: Array<{ metric: string; value: number; unit: string; confidence: number }>;
  }): BodyScanResponse {
    return {
      id: scan.id,
      measuredAt: scan.measuredAt.toISOString(),
      source: scan.source as ScanSource,
      measurements: scan.measurements.map((m) => ({
        metric: m.metric as BodyMetric | SegmentalSite,
        value: m.value,
        unit: m.unit,
        confidence: m.confidence,
      })),
    };
  }

  private toNutritionLogEntryResponse(entry: NutritionLogEntry): NutritionLogEntryResponse {
    return {
      id: entry.id,
      foodId: entry.foodId,
      loggedDate: entry.loggedDate,
      slot: entry.slot,
      servingLabel: entry.servingLabel,
      grams: entry.grams,
      kcal: entry.kcal,
      protein: entry.protein,
      carbs: entry.carbs,
      fat: entry.fat,
      groupId: entry.groupId,
      groupName: entry.groupName,
    };
  }

  private toWorkoutTemplateResponse(template: WorkoutTemplate): WorkoutTemplateResponse {
    return {
      id: template.id,
      name: template.name,
      activity: template.activity,
      basedOnTemplateId: template.basedOnTemplateId,
      notes: template.notes,
      estimatedDurationMinutes: template.estimatedDurationMinutes,
      isCustom: template.ownerUserId !== null,
      blocks: template.blocks.map((block) => this.toWorkoutBlockResponse(block)),
    };
  }

  private toWorkoutBlockResponse(block: WorkoutBlock): WorkoutBlockResponse {
    return {
      id: block.id,
      type: block.type,
      orderIndex: block.orderIndex,
      name: block.name,
      rounds: block.rounds,
      workSeconds: block.workSeconds,
      restSeconds: block.restSeconds,
      capSeconds: block.capSeconds,
      exercises: block.exercises.map((exercise) => this.toWorkoutExerciseResponse(exercise)),
    };
  }

  private toWorkoutExerciseResponse(exercise: WorkoutExercise): WorkoutExerciseResponse {
    return {
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      setCount: exercise.setCount,
      targetReps: exercise.targetReps,
      targetRepsMax: exercise.targetRepsMax,
      targetWeightKg: exercise.targetWeightKg,
      targetSeconds: exercise.targetSeconds,
      targetDistanceMeters: exercise.targetDistanceMeters,
      restSeconds: exercise.restSeconds,
      notes: exercise.notes,
    };
  }

  private toWorkoutSessionResponse(session: WorkoutSession): WorkoutSessionResponse {
    return {
      id: session.id,
      templateId: session.templateId,
      name: session.name,
      activity: session.activity,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      durationSeconds: session.durationSeconds,
      perceivedEffort: session.perceivedEffort,
      notes: session.notes,
      city: session.city,
      citySlug: session.citySlug,
      isLiveTracked: session.isLiveTracked,
      exercises: session.exercises.map((exercise) => this.toWorkoutSessionExerciseResponse(exercise)),
    };
  }

  private toWorkoutSessionExerciseResponse(exercise: WorkoutSessionExercise): WorkoutSessionExerciseResponse {
    return {
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      measure: exercise.measure,
      notes: exercise.notes,
      sets: exercise.sets.map((set) => this.toWorkoutSetResponse(set)),
    };
  }

  private toWorkoutSetResponse(set: WorkoutSet): WorkoutSetResponse {
    return {
      id: set.id,
      setIndex: set.setIndex,
      type: set.type,
      isCompleted: set.isCompleted,
      weightKg: set.weightKg,
      reps: set.reps,
      durationSeconds: set.durationSeconds,
      distanceMeters: set.distanceMeters,
      restSeconds: set.restSeconds,
      completedAt: set.completedAt ? set.completedAt.toISOString() : null,
    };
  }

  private toProgramsResponse(
    owned: Array<{
      id: string;
      slug: string;
      name: string;
      category: ProgramSummary['category'];
      level: ProgramSummary['level'];
      daysPerWeek: number;
      durationWeeks: number;
      description: string | null;
      isOwn: boolean;
      workoutCount: number;
    }>,
    enrollment: {
      id: string;
      programId: string;
      programSlug: string;
      programName: string;
      programVersion: number;
      startedAt: Date;
    } | null,
  ): AccountExportPrograms {
    return {
      owned: owned.map((row) => this.toProgramSummary(row)),
      enrollment: enrollment ? this.toProgramEnrollment(enrollment) : null,
    };
  }

  private toProgramSummary(row: {
    id: string;
    slug: string;
    name: string;
    category: ProgramSummary['category'];
    level: ProgramSummary['level'];
    daysPerWeek: number;
    durationWeeks: number;
    description: string | null;
    isOwn: boolean;
    workoutCount: number;
  }): ProgramSummary {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      level: row.level,
      daysPerWeek: row.daysPerWeek,
      durationWeeks: row.durationWeeks,
      description: row.description,
      isOwn: row.isOwn,
      workoutCount: row.workoutCount,
    };
  }

  private toProgramEnrollment(row: {
    id: string;
    programId: string;
    programSlug: string;
    programName: string;
    programVersion: number;
    startedAt: Date;
  }): ProgramEnrollment {
    return {
      id: row.id,
      programId: row.programId,
      programSlug: row.programSlug,
      programName: row.programName,
      programVersion: row.programVersion,
      startedAt: row.startedAt.toISOString(),
    };
  }

  private toConnectionResponse(connection: {
    status: string;
    externalUserId: string | null;
    lastSyncAt: Date | null;
  }): AccountExportConnection {
    return {
      provider: 'whoop',
      status: connection.status as AccountExportConnection['status'],
      externalUserId: connection.externalUserId,
      lastSyncAt: connection.lastSyncAt ? connection.lastSyncAt.toISOString() : null,
    };
  }
}
