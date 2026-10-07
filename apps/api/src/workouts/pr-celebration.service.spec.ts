import type { WorkoutSession } from "@forjd/domain";

import type { PushNotificationService } from "../notifications/push-notification.service";
import { PrCelebrationService } from "./pr-celebration.service";
import type { WorkoutsRepository } from "./workouts.repository";

// Phase 12F slice 5a (docs/product/phase-12f-plan.md). After a workout is stored, a lift that beats the person's best before
// it queues one PR push. It never fails the upload: a problem here is logged and the workout is already saved.
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const ENDED = new Date("2026-10-07T09:30:00.000Z");

const session = (over: Partial<WorkoutSession> = {}, weights: Record<string, number> = { squat: 125 }): WorkoutSession =>
  ({
    id: SESSION_ID,
    userId: "user-1",
    status: "completed",
    startedAt: new Date("2026-10-07T09:00:00.000Z"),
    endedAt: ENDED,
    exercises: Object.entries(weights).map(([exerciseId, weightKg], index) => ({
      id: `se-${index}`,
      sessionId: SESSION_ID,
      exerciseId,
      orderIndex: index,
      measure: "weight",
      notes: null,
      sets: [{ id: `s-${index}`, isCompleted: true, weightKg, reps: 5 }],
    })),
    ...over,
  }) as unknown as WorkoutSession;

const NAMES = new Map([
  ["squat", "Back squat"],
  ["bench", "Bench press"],
]);

const runSummary = (distanceMeters: number, movingSeconds: number) => ({ distanceMeters, movingSeconds });

function setup(
  priors: Map<string, number> = new Map([["squat", 120]]),
  run: { summary?: { distanceMeters: number; movingSeconds: number }; prior?: { bestDistanceMeters: number | null; bestPaceSecPerKm: number | null } } = {},
) {
  const repository = {
    priorLiftBestsForUser: jest.fn(async () => priors),
    runFiguresForSession: jest.fn(async () => run.summary ?? null),
    priorRunBestsForUser: jest.fn(async () => run.prior ?? { bestDistanceMeters: null, bestPaceSecPerKm: null }),
  };
  const push = {
    enqueue: jest.fn(async () => ({ result: "queued" }) as const),
    dispatchDue: jest.fn(async () => ({})),
  };
  const service = new PrCelebrationService(
    repository as unknown as WorkoutsRepository,
    push as unknown as PushNotificationService,
  );
  return { service, repository, push };
}

describe("PrCelebrationService", () => {
  it("queues one PR push naming the lift, keyed by the session, then tries to send it at once", async () => {
    const { service, repository, push } = setup();

    await service.celebrate(session(), NAMES);

    expect(repository.priorLiftBestsForUser).toHaveBeenCalledWith("user-1", SESSION_ID, new Date("2026-10-07T09:00:00.000Z"), ["squat"]);
    expect(push.enqueue).toHaveBeenCalledTimes(1);
    expect(push.enqueue).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "pr",
      dedupeKey: `pr:${SESSION_ID}`,
      content: { title: "New PR on Back squat", body: "Open FORJD to see it.", data: { type: "pr", sessionId: SESSION_ID } },
      occurredAt: ENDED,
    });
    expect(push.dispatchDue).toHaveBeenCalledTimes(1);
  });

  it("queues a PR push for a run that is the longest yet, with no figure in it", async () => {
    const { service, repository, push } = setup(new Map(), {
      summary: runSummary(12000, 4000),
      prior: { bestDistanceMeters: 10000, bestPaceSecPerKm: 300 },
    });

    await service.celebrate(session({ exercises: [] }), NAMES);

    expect(repository.priorRunBestsForUser).toHaveBeenCalledWith("user-1", SESSION_ID, new Date("2026-10-07T09:00:00.000Z"));
    expect(push.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: `pr:${SESSION_ID}`,
        content: { title: "New PR: your longest run", body: "Open FORJD to see it.", data: { type: "pr", sessionId: SESSION_ID } },
      }),
    );
  });

  it("queues a PR push for a faster pace over 2 km or more", async () => {
    const { service, push } = setup(new Map(), { summary: runSummary(5000, 1400), prior: { bestDistanceMeters: 8000, bestPaceSecPerKm: 300 } });

    await service.celebrate(session({ exercises: [] }), NAMES);

    expect(push.enqueue).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ title: "New PR: your fastest pace" }) }));
  });

  it("is one push with a count when a lift and a run both set records in the same session", async () => {
    const { service, push } = setup(undefined, { summary: runSummary(12000, 4000), prior: { bestDistanceMeters: 10000, bestPaceSecPerKm: null } });

    await service.celebrate(session(), NAMES);

    expect(push.enqueue).toHaveBeenCalledTimes(1);
    expect(push.enqueue).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ title: "2 new PRs in that session" }) }));
  });

  it("queues nothing for a first run, and does not look at runs for a session without one", async () => {
    const first = setup(new Map(), { summary: runSummary(5000, 1500) });
    await first.service.celebrate(session({ exercises: [] }), NAMES);
    const noRun = setup();
    await noRun.service.celebrate(session(), NAMES);

    expect(first.push.enqueue).not.toHaveBeenCalled();
    expect(noRun.repository.priorRunBestsForUser).not.toHaveBeenCalled();
  });

  it("says how many when a session set several records", async () => {
    const { service, push } = setup(new Map([["squat", 120], ["bench", 80]]));

    await service.celebrate(session({}, { squat: 125, bench: 85 }), NAMES);

    expect(push.enqueue).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ title: "2 new PRs in that session" }) }));
  });

  it("queues nothing for a first time, an equal lift, an unfinished session or a session without weighted sets", async () => {
    const first = setup(new Map());
    await first.service.celebrate(session(), NAMES);
    const equal = setup(new Map([["squat", 125]]));
    await equal.service.celebrate(session(), NAMES);
    const unfinished = setup();
    await unfinished.service.celebrate(session({ status: "in_progress" }), NAMES);
    const none = setup();
    await none.service.celebrate(session({ exercises: [] }), NAMES);

    for (const { push } of [first, equal, unfinished, none]) expect(push.enqueue).not.toHaveBeenCalled();
    expect(none.repository.priorLiftBestsForUser).not.toHaveBeenCalled();
  });

  it("does not try to send when the push was a repeat or the policy dropped it", async () => {
    const duplicate = setup();
    duplicate.push.enqueue.mockResolvedValue({ result: "duplicate" } as never);
    const dropped = setup();
    dropped.push.enqueue.mockResolvedValue({ result: "dropped", reason: "too_old" } as never);

    await duplicate.service.celebrate(session(), NAMES);
    await dropped.service.celebrate(session(), NAMES);

    expect(duplicate.push.dispatchDue).not.toHaveBeenCalled();
    expect(dropped.push.dispatchDue).not.toHaveBeenCalled();
  });

  it("never throws: a failed lookup, queue or send is swallowed and the workout is unaffected", async () => {
    const lookup = setup();
    lookup.repository.priorLiftBestsForUser.mockRejectedValue(new Error("db down"));
    const queue = setup();
    queue.push.enqueue.mockRejectedValue(new Error("db down"));
    const send = setup();
    send.push.dispatchDue.mockRejectedValue(new Error("expo down"));

    await expect(lookup.service.celebrate(session(), NAMES)).resolves.toBeUndefined();
    await expect(queue.service.celebrate(session(), NAMES)).resolves.toBeUndefined();
    await expect(send.service.celebrate(session(), NAMES)).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
