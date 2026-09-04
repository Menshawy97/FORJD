import { NotFoundException } from "@nestjs/common";
import { User } from "@forjd/domain";

import {
  ProgramEnrollmentRow,
  ProgramSummaryRow,
  ProgramWithWorkouts,
  ProgramsRepository,
} from "./programs.repository";
import { ProgramsService } from "./programs.service";

/**
 * Against a fake repository, not Postgres, and deliberately so: the repository's own SQL is
 * covered by `programs.repository.spec.ts` against a real database. What is under test here is
 * the layer above it -- turning a `null` into a 404 rather than a 403, refusing a malformed id
 * before it reaches the database at all, and deciding which fields reach the wire.
 *
 * CLAUDE.md rule 12 asks for authorization in code that can be unit-tested. This is that code,
 * which is why it carries a 100% coverage pin in `apps/api/package.json` alongside the other
 * services.
 */
describe("ProgramsService", () => {
  const viewer = { id: "11111111-1111-4111-8111-111111111111" } as User;

  const summaryRow: ProgramSummaryRow = {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "upper-lower",
    name: "Upper / Lower",
    category: "strength",
    level: "intermediate",
    daysPerWeek: 4,
    durationWeeks: 8,
    description: "Balanced strength for 3–5 sessions a week",
    version: 3,
    isOwn: false,
    workoutCount: 4,
  };

  const detailRow: ProgramWithWorkouts = {
    ...summaryRow,
    workouts: [
      {
        templateId: "33333333-3333-4333-8333-333333333333",
        name: "Upper Body A",
        activity: "strength",
        orderIndex: 0,
        dayOfWeek: null,
        exerciseNames: ["Barbell Bench Press - Medium Grip", "Bent Over Barbell Row"],
      },
    ],
  };

  const enrollmentRow: ProgramEnrollmentRow = {
    id: "44444444-4444-4444-8444-444444444444",
    programId: summaryRow.id,
    programSlug: summaryRow.slug,
    programName: summaryRow.name,
    programVersion: 2,
    startedAt: new Date("2026-09-01T08:30:00.000Z"),
  };

  const build = (overrides: Partial<Record<keyof ProgramsRepository, jest.Mock>> = {}) => {
    const repository = {
      listForUser: jest.fn().mockResolvedValue([summaryRow]),
      findByIdForUser: jest.fn().mockResolvedValue(detailRow),
      findActiveEnrollment: jest.fn().mockResolvedValue(null),
      enrol: jest.fn().mockResolvedValue(enrollmentRow),
      endActiveEnrollment: jest.fn().mockResolvedValue(true),
      ...overrides,
    } as unknown as ProgramsRepository;

    return { repository, service: new ProgramsService(repository) };
  };

  describe("list", () => {
    it("passes the caller's id, the category and the scope straight through to the query", async () => {
      const { repository, service } = build();

      await service.list(viewer, { scope: "mine", category: "running" });

      expect(repository.listForUser).toHaveBeenCalledWith({
        userId: viewer.id,
        scope: "mine",
        category: "running",
      });
    });

    it("wraps the rows in an envelope so the list can gain a sibling field later", async () => {
      const { service } = build();

      expect(await service.list(viewer, { scope: "preset" })).toEqual({
        items: [
          {
            id: summaryRow.id,
            slug: summaryRow.slug,
            name: summaryRow.name,
            category: "strength",
            level: "intermediate",
            daysPerWeek: 4,
            durationWeeks: 8,
            description: summaryRow.description,
            isOwn: false,
            workoutCount: 4,
          },
        ],
      });
    });

    /**
     * The catalogue has nothing to say about a program's version, and a field a list carries is a
     * field a client starts depending on.
     */
    it("keeps version off the list rows", async () => {
      const { service } = build();
      const response = await service.list(viewer, { scope: "preset" });
      expect(response.items[0]).not.toHaveProperty("version");
    });

    it("returns an empty list rather than failing when nothing matches", async () => {
      const { service } = build({ listForUser: jest.fn().mockResolvedValue([]) });
      expect((await service.list(viewer, { scope: "preset" })).items).toEqual([]);
    });
  });

  describe("getById", () => {
    it("returns the overview with its workouts", async () => {
      const { service } = build();
      const response = await service.getById(viewer, summaryRow.id);

      expect(response.version).toBe(3);
      expect(response.workouts).toEqual([
        {
          templateId: detailRow.workouts[0]!.templateId,
          name: "Upper Body A",
          activity: "strength",
          orderIndex: 0,
          dayOfWeek: null,
          exerciseNames: ["Barbell Bench Press - Medium Grip", "Bent Over Barbell Row"],
        },
      ]);
    });

    /**
     * A malformed id is refused here rather than passed down: Postgres rejects a non-uuid with an
     * error, which would surface as a 500 for what is plainly a client mistake.
     */
    it("refuses a malformed id without touching the database", async () => {
      const { repository, service } = build();

      await expect(service.getById(viewer, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findByIdForUser).not.toHaveBeenCalled();
    });

    /**
     * 404, never 403. A stranger's program, a deleted one and an id that never existed are one
     * answer, so the endpoint cannot be used to discover that a program exists and is not yours.
     */
    it("turns a repository null into a 404 rather than a 403", async () => {
      const { service } = build({ findByIdForUser: jest.fn().mockResolvedValue(null) });

      await expect(
        service.getById(viewer, "55555555-5555-4555-8555-555555555555"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("asks the repository for the program as this viewer, never unscoped", async () => {
      const { repository, service } = build();
      await service.getById(viewer, summaryRow.id);
      expect(repository.findByIdForUser).toHaveBeenCalledWith(summaryRow.id, viewer.id);
    });
  });

  describe("enrol", () => {
    it("returns the new enrolment", async () => {
      const { service } = build();
      const response = await service.enrol(viewer, summaryRow.id);

      expect(response.enrollment.programId).toBe(summaryRow.id);
      expect(response.enrollment.startedAt).toBe("2026-09-01T08:30:00.000Z");
    });

    it("refuses a malformed id without reaching the database", async () => {
      const { repository, service } = build();

      await expect(service.enrol(viewer, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.enrol).not.toHaveBeenCalled();
    });

    /**
     * Enrolling in a program the caller cannot see is the same 404 as reading one -- a 403 would
     * confirm that a program exists and belongs to somebody else.
     */
    it("turns a repository null into a 404 rather than a 403 when enrolling", async () => {
      const { service } = build({ enrol: jest.fn().mockResolvedValue(null) });

      await expect(
        service.enrol(viewer, "55555555-5555-4555-8555-555555555555"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("enrols as this viewer, never as anybody else", async () => {
      const { repository, service } = build();
      await service.enrol(viewer, summaryRow.id);
      expect(repository.enrol).toHaveBeenCalledWith(viewer.id, summaryRow.id);
    });
  });

  describe("stopFollowing", () => {
    it("ends this viewer active enrolment", async () => {
      const { repository, service } = build();
      await service.stopFollowing(viewer);
      expect(repository.endActiveEnrollment).toHaveBeenCalledWith(viewer.id);
    });

    /** A second tap, or a tap from a screen one request stale, is not a client error. */
    it("succeeds even when nothing was being followed", async () => {
      const { service } = build({ endActiveEnrollment: jest.fn().mockResolvedValue(false) });
      await expect(service.stopFollowing(viewer)).resolves.toBeUndefined();
    });
  });

  describe("getEnrollment", () => {
    /** Following nothing is the ordinary state, not a 404. */
    it("returns an explicit null when the athlete follows nothing", async () => {
      const { service } = build();
      expect(await service.getEnrollment(viewer)).toEqual({ enrollment: null });
    });

    it("serialises the active enrolment, with startedAt as an ISO string", async () => {
      const { service } = build({
        findActiveEnrollment: jest.fn().mockResolvedValue(enrollmentRow),
      });

      expect(await service.getEnrollment(viewer)).toEqual({
        enrollment: {
          id: enrollmentRow.id,
          programId: summaryRow.id,
          programSlug: "upper-lower",
          programName: "Upper / Lower",
          programVersion: 2,
          startedAt: "2026-09-01T08:30:00.000Z",
        },
      });
    });

    /**
     * The version the athlete *began under*, not the program's current one. Those two differ the
     * moment a program is edited, and conflating them would make the column meaningless.
     */
    it("reports the enrolment's own version, not the program's current version", async () => {
      const { service } = build({
        findActiveEnrollment: jest.fn().mockResolvedValue(enrollmentRow),
      });

      const response = await service.getEnrollment(viewer);
      expect(response.enrollment?.programVersion).toBe(2);
      expect(summaryRow.version).toBe(3);
    });

    it("asks only for this viewer's enrolment", async () => {
      const { repository, service } = build();
      await service.getEnrollment(viewer);
      expect(repository.findActiveEnrollment).toHaveBeenCalledWith(viewer.id);
    });
  });
});
