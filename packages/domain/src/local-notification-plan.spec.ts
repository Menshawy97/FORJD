import {
  isAnyLadderCloseToTarget,
  limitPlannedNotifications,
  MAX_PENDING_LOCAL_NOTIFICATIONS,
  planLocalNotifications,
  type LocalNotificationPlanInput,
  type PlannedLocalNotification,
} from "./local-notification-plan";

// 2026-10-07 is a Wednesday. Weeks start on Saturday (ADR-056), so Saturdays are 10-10 and 10-17.
const WEDNESDAY = "2026-10-07";
const at = (hours: number, minutes = 0): number => hours * 60 + minutes;

const base = (over: Partial<LocalNotificationPlanInput> = {}): LocalNotificationPlanInput => ({
  now: { date: WEDNESDAY, minute: at(8) },
  switches: { workout: true, weekly: true },
  recentSessions: [],
  programWorkouts: [],
  ...over,
});

/** Three Wednesdays in the last four weeks, all starting at 18:00. */
const wednesdayHabit = [
  { date: "2026-09-30", startMinute: at(18) },
  { date: "2026-09-23", startMinute: at(18) },
  { date: "2026-09-16", startMinute: at(18) },
];

const ofKind = (plan: PlannedLocalNotification[], kind: PlannedLocalNotification["kind"]) =>
  plan.filter((entry) => entry.kind === kind);

describe("planLocalNotifications: switches", () => {
  it("plans nothing when both switches are off", () => {
    const plan = planLocalNotifications(
      base({ switches: { workout: false, weekly: false }, recentSessions: wednesdayHabit }),
    );

    expect(plan).toEqual([]);
  });

  it("plans no reminders when only the workout switch is off, and no recap when only the weekly switch is off", () => {
    const noWorkout = planLocalNotifications(
      base({ switches: { workout: false, weekly: true }, recentSessions: wednesdayHabit }),
    );
    const noWeekly = planLocalNotifications(
      base({ switches: { workout: true, weekly: false }, recentSessions: wednesdayHabit }),
    );

    expect(ofKind(noWorkout, "workout")).toEqual([]);
    expect(ofKind(noWorkout, "weekly").length).toBeGreaterThan(0);
    expect(ofKind(noWeekly, "weekly")).toEqual([]);
    expect(ofKind(noWeekly, "workout").length).toBeGreaterThan(0);
  });
});

describe("planLocalNotifications: workout reminders learned from history", () => {
  it("reminds 30 minutes before the usual start on the days the person usually trains", () => {
    const plan = ofKind(planLocalNotifications(base({ recentSessions: wednesdayHabit })), "workout");

    expect(plan).toEqual([
      {
        id: "forjd-local:workout:2026-10-07",
        kind: "workout",
        date: "2026-10-07",
        minute: at(17, 30),
        title: "Workout in 30 minutes",
        body: "You usually start around 18:00.",
        route: "/train",
      },
      {
        id: "forjd-local:workout:2026-10-14",
        kind: "workout",
        date: "2026-10-14",
        minute: at(17, 30),
        title: "Workout in 30 minutes",
        body: "You usually start around 18:00.",
        route: "/train",
      },
    ]);
  });

  it("stays quiet when there is no history at all", () => {
    expect(ofKind(planLocalNotifications(base()), "workout")).toEqual([]);
  });

  it("stays quiet for a weekday trained in only one of the last four weeks", () => {
    const plan = planLocalNotifications(base({ recentSessions: [wednesdayHabit[0]!] }));

    expect(ofKind(plan, "workout")).toEqual([]);
  });

  it("counts a weekday when it was trained in two different weeks of the last four", () => {
    const plan = planLocalNotifications(base({ recentSessions: [wednesdayHabit[0]!, wednesdayHabit[2]!] }));

    expect(ofKind(plan, "workout").map((entry) => entry.date)).toEqual(["2026-10-07", "2026-10-14"]);
  });

  it("ignores sessions older than four weeks", () => {
    const old = [
      { date: "2026-08-26", startMinute: at(18) },
      { date: "2026-08-19", startMinute: at(18) },
      { date: "2026-08-12", startMinute: at(18) },
    ];

    expect(ofKind(planLocalNotifications(base({ recentSessions: old })), "workout")).toEqual([]);
  });

  it("uses the median start, so one odd session does not move the reminder", () => {
    const sessions = [
      { date: "2026-09-30", startMinute: at(17) },
      { date: "2026-09-23", startMinute: at(17) },
      { date: "2026-09-16", startMinute: at(20) },
    ];

    const [first] = ofKind(planLocalNotifications(base({ recentSessions: sessions })), "workout");

    expect(first?.minute).toBe(at(16, 30));
  });

  it("rounds the usual start to the nearest five minutes so the time reads naturally", () => {
    const sessions = [
      { date: "2026-09-30", startMinute: at(18, 2) },
      { date: "2026-09-23", startMinute: at(18, 4) },
      { date: "2026-09-16", startMinute: at(18, 3) },
    ];

    const [first] = ofKind(planLocalNotifications(base({ recentSessions: sessions })), "workout");

    expect(first?.minute).toBe(at(17, 35));
    expect(first?.body).toBe("You usually start around 18:05.");
  });

  it("skips today when the person has already trained today", () => {
    const trainedToday = [...wednesdayHabit, { date: WEDNESDAY, startMinute: at(7, 30) }];

    const plan = ofKind(planLocalNotifications(base({ recentSessions: trainedToday })), "workout");

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-14"]);
  });

  it("leaves out a reminder whose time has already passed today", () => {
    const plan = ofKind(
      planLocalNotifications(base({ now: { date: WEDNESDAY, minute: at(17, 45) }, recentSessions: wednesdayHabit })),
      "workout",
    );

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-14"]);
  });

  it("drops a reminder that would land in quiet hours, 22:00 to 07:00, instead of moving it", () => {
    const early = [
      { date: "2026-09-30", startMinute: at(7, 10) },
      { date: "2026-09-23", startMinute: at(7, 10) },
    ];
    const late = [
      { date: "2026-09-30", startMinute: at(22, 45) },
      { date: "2026-09-23", startMinute: at(22, 45) },
    ];
    const justAfterMidnight = [
      { date: "2026-09-30", startMinute: at(0, 10) },
      { date: "2026-09-23", startMinute: at(0, 10) },
    ];

    expect(ofKind(planLocalNotifications(base({ recentSessions: early })), "workout")).toEqual([]);
    expect(ofKind(planLocalNotifications(base({ recentSessions: late })), "workout")).toEqual([]);
    expect(ofKind(planLocalNotifications(base({ recentSessions: justAfterMidnight })), "workout")).toEqual([]);
  });

  it("allows a reminder exactly at the edges of the quiet window", () => {
    const edge = [
      { date: "2026-09-30", startMinute: at(7, 30) },
      { date: "2026-09-23", startMinute: at(7, 30) },
    ];

    const [first] = ofKind(planLocalNotifications(base({ now: { date: WEDNESDAY, minute: at(0) }, recentSessions: edge })), "workout");

    expect(first?.minute).toBe(at(7));
  });
});

describe("planLocalNotifications: a custom program's weekdays decide the days", () => {
  const monday = { dayOfWeek: 1, workoutName: "Push Day" };
  const friday = { dayOfWeek: 5, workoutName: "Legs" };
  const mondayHistory = [{ date: "2026-10-05", startMinute: at(18) }];

  it("reminds on the program's weekdays even with a single week of history, and names the workout", () => {
    const plan = ofKind(
      planLocalNotifications(base({ recentSessions: mondayHistory, programWorkouts: [monday] })),
      "workout",
    );

    // Mondays inside the 14-day horizon (10-07 to 10-20): 10-12 and 10-19.
    expect(plan).toEqual(
      ["2026-10-12", "2026-10-19"].map((date) =>
        expect.objectContaining({
          date,
          minute: at(17, 30),
          title: "Workout in 30 minutes",
          body: "Push Day is next.",
        }),
      ),
    );
  });

  it("takes the time from that weekday's own history, else from the person's overall usual start", () => {
    const plan = ofKind(
      planLocalNotifications(base({ recentSessions: mondayHistory, programWorkouts: [monday, friday] })),
      "workout",
    );

    const friday9th = plan.find((entry) => entry.date === "2026-10-09");
    expect(friday9th).toEqual(expect.objectContaining({ minute: at(17, 30), body: "Legs is next." }));
  });

  it("ignores the habit weekdays once a program names its own days", () => {
    const plan = ofKind(
      planLocalNotifications(base({ recentSessions: [...wednesdayHabit, ...mondayHistory], programWorkouts: [monday] })),
      "workout",
    );

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-12", "2026-10-19"]);
  });

  it("names the first workout when a weekday has more than one", () => {
    const plan = ofKind(
      planLocalNotifications(
        base({ recentSessions: mondayHistory, programWorkouts: [monday, { dayOfWeek: 1, workoutName: "Core" }] }),
      ),
      "workout",
    );

    expect(plan[0]?.body).toBe("Push Day is next.");
  });

  it("stays quiet when there is no history to take a time from", () => {
    expect(ofKind(planLocalNotifications(base({ programWorkouts: [monday] })), "workout")).toEqual([]);
  });
});

describe("planLocalNotifications: the weekly recap", () => {
  it("arrives on Saturday morning at 09:00, with a fixed message and no numbers", () => {
    const plan = ofKind(planLocalNotifications(base()), "weekly");

    expect(plan).toEqual([
      {
        id: "forjd-local:weekly:2026-10-10",
        kind: "weekly",
        date: "2026-10-10",
        minute: at(9),
        title: "Your week is ready",
        body: "See how it went.",
        route: "/progress",
      },
      expect.objectContaining({ id: "forjd-local:weekly:2026-10-17", date: "2026-10-17" }),
    ]);
  });

  it("leaves out this Saturday's recap once 09:00 has passed", () => {
    const plan = ofKind(
      planLocalNotifications(base({ now: { date: "2026-10-10", minute: at(9, 30) } })),
      "weekly",
    );

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-17"]);
  });

  it("keeps this Saturday's recap when it is still before 09:00", () => {
    const plan = ofKind(
      planLocalNotifications(base({ now: { date: "2026-10-10", minute: at(8, 59) } })),
      "weekly",
    );

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-10", "2026-10-17"]);
  });

  it("is correct across a year boundary and a leap day", () => {
    const year = ofKind(planLocalNotifications(base({ now: { date: "2027-12-30", minute: at(8) } })), "weekly");
    const leap = ofKind(planLocalNotifications(base({ now: { date: "2028-02-25", minute: at(8) } })), "weekly");

    expect(year[0]?.date).toBe("2028-01-01");
    // 02-26 + 7 days is 03-04 only because 2028 has a 29 February.
    expect(leap.map((entry) => entry.date)).toEqual(["2028-02-26", "2028-03-04"]);
  });
});

describe("planLocalNotifications: the horizon and the order", () => {
  it("plans exactly the next 14 days: today and the 13 after it", () => {
    // Saturdays: 10-10 and 10-17 are inside 10-07..10-20; 10-24 is outside.
    const plan = ofKind(planLocalNotifications(base({ now: { date: WEDNESDAY, minute: at(8) } })), "weekly");

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-10", "2026-10-17"]);
  });

  it("includes a Saturday on the last day of the horizon and not the day after", () => {
    // From Sunday 10-11 the 14-day horizon is 10-11..10-24, which includes Saturday 10-24.
    const plan = ofKind(planLocalNotifications(base({ now: { date: "2026-10-11", minute: at(8) } })), "weekly");

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-17", "2026-10-24"]);
  });

  it("lists everything in time order", () => {
    const plan = planLocalNotifications(base({ recentSessions: wednesdayHabit }));

    const keys = plan.map((entry) => `${entry.date} ${String(entry.minute).padStart(4, "0")}`);
    expect([...keys].sort()).toEqual(keys);
  });

  it("puts two notifications at the same minute in a fixed order, the recap before the reminder", () => {
    // A Saturday-morning habit (09:30) gives a reminder at 09:00, the same minute as the recap.
    const saturdays = [
      { date: "2026-09-19", startMinute: at(9, 30) },
      { date: "2026-09-26", startMinute: at(9, 30) },
      { date: "2026-10-03", startMinute: at(9, 30) },
    ];

    const plan = planLocalNotifications(base({ recentSessions: saturdays }));

    const firstSaturday = plan.filter((entry) => entry.date === "2026-10-10");
    expect(firstSaturday.map((entry) => entry.kind)).toEqual(["weekly", "workout"]);
    expect(firstSaturday.map((entry) => entry.minute)).toEqual([at(9), at(9)]);
  });

  it("gives every notification a unique, deterministic id", () => {
    const first = planLocalNotifications(base({ recentSessions: wednesdayHabit }));
    const second = planLocalNotifications(base({ recentSessions: wednesdayHabit }));

    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(new Set(first.map((entry) => entry.id)).size).toBe(first.length);
    expect(first.every((entry) => entry.id.startsWith("forjd-local:"))).toBe(true);
  });
});

describe("limitPlannedNotifications", () => {
  const entry = (n: number): PlannedLocalNotification => ({
    id: `forjd-local:weekly:${n}`,
    kind: "weekly",
    date: `2026-10-${String(n).padStart(2, "0")}`,
    minute: at(9),
    title: "t",
    body: "b",
    route: "/progress",
  });

  it("keeps the earliest and drops the furthest when the plan is longer than the limit", () => {
    const list = [entry(10), entry(11), entry(12), entry(13)];

    expect(limitPlannedNotifications(list, 3).map((item) => item.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
  });

  it("returns the list unchanged when it fits", () => {
    const list = [entry(10), entry(11)];

    expect(limitPlannedNotifications(list, 3)).toEqual(list);
  });

  it("stays under iOS's 64-notification limit by default", () => {
    expect(MAX_PENDING_LOCAL_NOTIFICATIONS).toBeLessThan(64);
    expect(MAX_PENDING_LOCAL_NOTIFICATIONS).toBe(60);
  });
});

// Review of 12E-1: the types promise "YYYY-MM-DD" and "0 to 1439", but rows come from the server and the
// phone's clock, so the planner must not trust them. A bad "now" plans nothing; a bad session is ignored.
describe("planLocalNotifications: input it does not trust", () => {
  it("plans nothing, and does not throw, when the current date is malformed or does not exist", () => {
    for (const date of ["", "tomorrow", "2026-13-01", "2026-02-31", "2026-10-7"]) {
      expect(planLocalNotifications(base({ now: { date, minute: at(8) } }))).toEqual([]);
    }
  });

  it("plans nothing when the current minute is not a whole minute of the day", () => {
    for (const minute of [Number.NaN, -1, 1440, 8.5]) {
      expect(planLocalNotifications(base({ now: { date: WEDNESDAY, minute } }))).toEqual([]);
    }
  });

  it("ignores sessions with a malformed date or an impossible start, as if they were not there", () => {
    const junk = [
      { date: "not a date", startMinute: at(18) },
      { date: "2026-02-31", startMinute: at(18) },
      { date: "2026-09-30", startMinute: Number.NaN },
      { date: "2026-09-30", startMinute: -5 },
      { date: "2026-09-30", startMinute: 2000 },
      { date: "2026-09-30", startMinute: 1080.5 },
    ];

    const withJunk = planLocalNotifications(base({ recentSessions: [...wednesdayHabit, ...junk] }));
    const without = planLocalNotifications(base({ recentSessions: wednesdayHabit }));

    expect(withJunk).toEqual(without);
    expect(withJunk.every((entry) => Number.isInteger(entry.minute))).toBe(true);
  });
});

// Review of 12E-1: pin the edges, so an off-by-one in the four-week window or the quiet window is caught.
describe("planLocalNotifications: the edges", () => {
  it("counts a session exactly 27 days ago, the oldest day of the four-week window", () => {
    // 2026-09-10 is 27 days before 10-07; both are Thursdays, in different seven-day blocks.
    const sessions = [
      { date: "2026-09-10", startMinute: at(18) },
      { date: "2026-09-17", startMinute: at(18) },
    ];

    const plan = ofKind(planLocalNotifications(base({ recentSessions: sessions })), "workout");

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-08", "2026-10-15"]);
  });

  it("does not count a session 28 days ago, the first day outside the window", () => {
    // 2026-09-09 is 28 days before 10-07, so only one Wednesday session is left inside the window.
    const sessions = [
      { date: "2026-09-09", startMinute: at(18) },
      { date: "2026-09-16", startMinute: at(18) },
    ];

    expect(ofKind(planLocalNotifications(base({ recentSessions: sessions })), "workout")).toEqual([]);
  });

  it("drops a reminder at exactly 22:00 and keeps one at 21:55", () => {
    const startingAt = (minute: number) => [
      { date: "2026-09-30", startMinute: minute },
      { date: "2026-09-23", startMinute: minute },
    ];

    expect(ofKind(planLocalNotifications(base({ recentSessions: startingAt(at(22, 30)) })), "workout")).toEqual([]);
    expect(ofKind(planLocalNotifications(base({ recentSessions: startingAt(at(22, 25)) })), "workout")[0]?.minute).toBe(at(21, 55));
  });

  it("stays quiet for a program weekday when the person has history only on other weekdays, using their overall usual start", () => {
    const planned = ofKind(
      planLocalNotifications(
        base({
          recentSessions: [{ date: "2026-10-05", startMinute: at(19) }],
          programWorkouts: [{ dayOfWeek: 4, workoutName: "Pull" }],
        }),
      ),
      "workout",
    );

    expect(planned.map((entry) => entry.date)).toEqual(["2026-10-08", "2026-10-15"]);
    expect(planned[0]).toEqual(expect.objectContaining({ minute: at(18, 30), body: "Pull is next." }));
  });
});

describe("planLocalNotifications: log your meals (12E-5)", () => {
  const withMeals = (over: Partial<LocalNotificationPlanInput> = {}) =>
    base({ switches: { workout: false, weekly: false, meals: true }, ...over });

  it("is off unless the meals switch is on", () => {
    expect(ofKind(planLocalNotifications(base()), "meals")).toEqual([]);
  });

  it("reminds at 19:30 every day of the fortnight, once a day", () => {
    const plan = ofKind(planLocalNotifications(withMeals()), "meals");

    expect(plan).toHaveLength(14);
    expect(plan[0]).toEqual({
      id: "forjd-local:meals:2026-10-07",
      kind: "meals",
      date: "2026-10-07",
      minute: at(19, 30),
      title: "Food log",
      body: "Haven't logged food today? Add a meal.",
      route: "/nutrition",
    });
    expect(new Set(plan.map((entry) => entry.date)).size).toBe(14);
    expect(plan.at(-1)?.date).toBe("2026-10-20");
  });

  it("skips today once 19:30 has passed, and keeps tomorrow", () => {
    const plan = ofKind(planLocalNotifications(withMeals({ now: { date: WEDNESDAY, minute: at(20) } })), "meals");

    expect(plan).toHaveLength(13);
    expect(plan[0]?.date).toBe("2026-10-08");
  });

  it("does not remind at 19:30 itself, only before it", () => {
    const plan = ofKind(planLocalNotifications(withMeals({ now: { date: WEDNESDAY, minute: at(19, 30) } })), "meals");

    expect(plan[0]?.date).toBe("2026-10-08");
  });

  it("drops only today's reminder once a meal is logged today", () => {
    const plan = ofKind(planLocalNotifications(withMeals({ mealLoggedToday: true })), "meals");

    expect(plan).toHaveLength(13);
    expect(plan[0]?.date).toBe("2026-10-08");
  });

  it("never falls inside quiet hours", () => {
    for (const entry of ofKind(planLocalNotifications(withMeals()), "meals")) {
      expect(entry.minute).toBeGreaterThanOrEqual(at(7));
      expect(entry.minute).toBeLessThan(at(22));
    }
  });

  it("sits in time order beside the other reminders", () => {
    const plan = planLocalNotifications(
      base({ switches: { workout: true, weekly: true, meals: true }, recentSessions: wednesdayHabit }),
    );
    const keys = plan.map((entry) => `${entry.date} ${String(entry.minute).padStart(4, "0")}`);

    expect(keys).toEqual([...keys].sort());
  });
});

describe("planLocalNotifications: no workout yet this week (12E-6)", () => {
  // Now is Wednesday 2026-10-07. This week runs Saturday 10-03 to Friday 10-09, so its Thursday is 10-08 and the
  // next week's is 10-15.
  const withNoWorkout = (over: Partial<LocalNotificationPlanInput> = {}) =>
    base({ switches: { workout: false, weekly: false, noWorkout: true }, ...over });
  const dates = (plan: PlannedLocalNotification[]) => ofKind(plan, "noWorkout").map((entry) => entry.date);

  it("is off unless the switch is on", () => {
    expect(ofKind(planLocalNotifications(base()), "noWorkout")).toEqual([]);
  });

  it("reminds on Thursday at 18:00 in this week and the next, when nothing has been trained", () => {
    const plan = ofKind(planLocalNotifications(withNoWorkout()), "noWorkout");

    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-08", "2026-10-15"]);
    expect(plan[0]).toEqual({
      id: "forjd-local:noWorkout:2026-10-08",
      kind: "noWorkout",
      date: "2026-10-08",
      minute: at(18),
      title: "No workout yet this week",
      body: "Fit one in before the week closes.",
      route: "/train",
    });
  });

  it("names the streak for this week's Thursday only, because later weeks' streak is not known yet", () => {
    const plan = ofKind(planLocalNotifications(withNoWorkout({ weekStreak: 6 })), "noWorkout");

    expect(plan[0]?.body).toBe("Keep your 6-week streak.");
    expect(plan[1]?.body).toBe("Fit one in before the week closes.");
  });

  it("does not mention a streak of zero", () => {
    expect(ofKind(planLocalNotifications(withNoWorkout({ weekStreak: 0 })), "noWorkout")[0]?.body).toBe(
      "Fit one in before the week closes.",
    );
  });

  it("is dropped for a week with a completed session, and kept for the next", () => {
    const plan = planLocalNotifications(withNoWorkout({ recentSessions: [{ date: "2026-10-05", startMinute: at(7) }] }));

    expect(dates(plan)).toEqual(["2026-10-15"]);
  });

  it("counts a session on the Saturday the week starts, but not one from the Friday before", () => {
    const onSaturday = planLocalNotifications(withNoWorkout({ recentSessions: [{ date: "2026-10-03", startMinute: at(9) }] }));
    const onFriday = planLocalNotifications(withNoWorkout({ recentSessions: [{ date: "2026-10-02", startMinute: at(9) }] }));

    expect(dates(onSaturday)).toEqual(["2026-10-15"]);
    expect(dates(onFriday)).toEqual(["2026-10-08", "2026-10-15"]);
  });

  it("planned on a Friday, has no Thursday left in this week and uses the generic wording for the next", () => {
    const plan = ofKind(
      planLocalNotifications(withNoWorkout({ now: { date: "2026-10-09", minute: at(12) }, weekStreak: 5 })),
      "noWorkout",
    );

    // The fortnight from Friday 10-09 holds the next two Thursdays; neither is in the week being planned from.
    expect(plan.map((entry) => entry.date)).toEqual(["2026-10-15", "2026-10-22"]);
    expect(plan.map((entry) => entry.body)).toEqual(["Fit one in before the week closes.", "Fit one in before the week closes."]);
  });

  it("planned on a Saturday, names the streak for the Thursday five days ahead", () => {
    const plan = ofKind(
      planLocalNotifications(withNoWorkout({ now: { date: "2026-10-10", minute: at(12) }, weekStreak: 5 })),
      "noWorkout",
    );

    expect(plan[0]?.date).toBe("2026-10-15");
    expect(plan[0]?.body).toBe("Keep your 5-week streak.");
  });

  it("counts a session from late on the Friday before as belonging to the week that Friday closes", () => {
    const plan = planLocalNotifications(
      withNoWorkout({ now: { date: "2026-10-09", minute: at(12) }, recentSessions: [{ date: "2026-10-09", startMinute: at(23, 50) }] }),
    );

    // The Friday session is in the week that already had its Thursday, so it does not drop the Thursdays that follow.
    expect(dates(plan)).toEqual(["2026-10-15", "2026-10-22"]);
  });

  it("on a Thursday, keeps today's reminder before 18:00 and drops it after, or once trained today", () => {
    const thursday = "2026-10-08";
    const before = planLocalNotifications(withNoWorkout({ now: { date: thursday, minute: at(12) } }));
    const after = planLocalNotifications(withNoWorkout({ now: { date: thursday, minute: at(19) } }));
    const trained = planLocalNotifications(
      withNoWorkout({ now: { date: thursday, minute: at(12) }, recentSessions: [{ date: thursday, startMinute: at(8) }] }),
    );

    expect(dates(before)).toEqual(["2026-10-08", "2026-10-15"]);
    expect(dates(after)).toEqual(["2026-10-15"]);
    expect(dates(trained)).toEqual(["2026-10-15"]);
  });
});

describe("isAnyLadderCloseToTarget (12E-7)", () => {
  it("is true when a ladder is at least 75% of the way and has not reached its target", () => {
    expect(isAnyLadderCloseToTarget([{ target: 100, total: 75 }])).toBe(true);
    expect(isAnyLadderCloseToTarget([{ target: 4, total: 3 }])).toBe(true);
    expect(isAnyLadderCloseToTarget([{ target: 100, total: 99 }])).toBe(true);
  });

  it("is false below 75%, so a far-off week is not nagged", () => {
    expect(isAnyLadderCloseToTarget([{ target: 100, total: 74 }])).toBe(false);
    expect(isAnyLadderCloseToTarget([{ target: 100, total: 0 }])).toBe(false);
  });

  it("is false for a ladder that has already reached its target", () => {
    expect(isAnyLadderCloseToTarget([{ target: 100, total: 100 }])).toBe(false);
    expect(isAnyLadderCloseToTarget([{ target: 100, total: 140 }])).toBe(false);
  });

  it("looks at every ladder, and ignores one with no target", () => {
    expect(isAnyLadderCloseToTarget([{ target: 100, total: 10 }, { target: 5, total: 4 }])).toBe(true);
    expect(isAnyLadderCloseToTarget([{ target: 0, total: 0 }])).toBe(false);
    expect(isAnyLadderCloseToTarget([])).toBe(false);
  });
});

describe("planLocalNotifications: Weekly Forge closing (12E-7)", () => {
  // The Forge week that starts Saturday 2026-10-03 closes Friday 2026-10-09.
  const withForge = (over: Partial<LocalNotificationPlanInput> = {}) =>
    base({
      switches: { workout: false, weekly: false, forgeClosing: true },
      forgeWeek: { weekStart: "2026-10-03", closeToTarget: true },
      ...over,
    });

  it("is off unless the switch is on", () => {
    const plan = planLocalNotifications(base({ forgeWeek: { weekStart: "2026-10-03", closeToTarget: true } }));

    expect(ofKind(plan, "forgeClosing")).toEqual([]);
  });

  it("reminds on the Friday the week closes, at 18:00, when a ladder is close", () => {
    expect(ofKind(planLocalNotifications(withForge()), "forgeClosing")).toEqual([
      {
        id: "forjd-local:forgeClosing:2026-10-09",
        kind: "forgeClosing",
        date: "2026-10-09",
        minute: at(18),
        title: "Weekly Forge closes tonight",
        body: "Check how close you are.",
        route: "/",
      },
    ]);
  });

  it("stays quiet when no ladder is close, or when there is no Forge week (the feature is off)", () => {
    expect(ofKind(planLocalNotifications(withForge({ forgeWeek: { weekStart: "2026-10-03", closeToTarget: false } })), "forgeClosing")).toEqual([]);
    expect(ofKind(planLocalNotifications(withForge({ forgeWeek: undefined })), "forgeClosing")).toEqual([]);
  });

  it("keeps it on the Friday itself before 18:00 and drops it after", () => {
    const friday = "2026-10-09";
    const before = planLocalNotifications(withForge({ now: { date: friday, minute: at(12) } }));
    const after = planLocalNotifications(withForge({ now: { date: friday, minute: at(18, 30) } }));

    expect(ofKind(before, "forgeClosing")).toHaveLength(1);
    expect(ofKind(after, "forgeClosing")).toEqual([]);
  });

  it("does not plan for a Friday beyond the fortnight", () => {
    const plan = planLocalNotifications(withForge({ forgeWeek: { weekStart: "2026-10-24", closeToTarget: true } }));

    expect(ofKind(plan, "forgeClosing")).toEqual([]);
  });
});
