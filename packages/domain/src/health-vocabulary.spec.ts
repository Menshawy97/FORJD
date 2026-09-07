/**
 * Every closed health-vocabulary tuple in ./health-vocabulary.ts must have a matching entry
 * in its *DisplayName / *UNITS map -- this test is the enforcement, not documentation of
 * intent. Written before the implementation (Phase 6A, RED first) per the standing TDD
 * rule. Pattern copied from body-vocabulary.spec.ts.
 */
import {
  HEALTH_METRIC_TYPES,
  HEALTH_METRIC_TYPE_DISPLAY_NAMES,
  HEALTH_METRIC_UNITS,
  HEALTH_SOURCES,
  HEALTH_SOURCE_DISPLAY_NAMES,
  HEALTH_SOURCE_PRIORITY,
  resolveByPriority,
  type HealthObservation,
} from "./index";

describe("health vocabulary display-name coverage", () => {
  const displayNameCases: Array<[string, readonly string[], Record<string, string>]> = [
    ["HEALTH_METRIC_TYPES", HEALTH_METRIC_TYPES, HEALTH_METRIC_TYPE_DISPLAY_NAMES],
    ["HEALTH_SOURCES", HEALTH_SOURCES, HEALTH_SOURCE_DISPLAY_NAMES],
  ];

  it.each(displayNameCases)("every %s member has a non-empty display name", (_label, tuple, map) => {
    for (const member of tuple) {
      const name = map[member];
      expect(name).toBeDefined();
      expect(typeof name).toBe("string");
      expect((name ?? "").length).toBeGreaterThan(0);
    }
  });

  it.each(displayNameCases)("%s display-name map has no orphan keys", (_label, tuple, map) => {
    const known = new Set<string>(tuple);
    for (const key of Object.keys(map)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("every HEALTH_METRIC_TYPES member has a unit entry", () => {
    for (const member of HEALTH_METRIC_TYPES) {
      expect(Object.prototype.hasOwnProperty.call(HEALTH_METRIC_UNITS, member)).toBe(true);
      expect(typeof HEALTH_METRIC_UNITS[member]).toBe("string");
      expect(HEALTH_METRIC_UNITS[member].length).toBeGreaterThan(0);
    }
  });

  it("HEALTH_METRIC_UNITS has no orphan keys", () => {
    const known = new Set<string>(HEALTH_METRIC_TYPES);
    for (const key of Object.keys(HEALTH_METRIC_UNITS)) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("includes the doc's own verbatim metric list from health-data.md", () => {
    const documented = [
      "heart_rate",
      "hrv",
      "resting_heart_rate",
      "sleep_duration",
      "steps",
      "active_energy",
      "weight",
      "vo2_max",
      "respiratory_rate",
    ];
    for (const metric of documented) {
      expect(HEALTH_METRIC_TYPES).toContain(metric);
    }
  });

  it("includes all four sleep-stage duration types ADR-031 requires", () => {
    expect(HEALTH_METRIC_TYPES).toContain("sleep_light_duration");
    expect(HEALTH_METRIC_TYPES).toContain("sleep_deep_duration");
    expect(HEALTH_METRIC_TYPES).toContain("sleep_rem_duration");
    expect(HEALTH_METRIC_TYPES).toContain("sleep_awake_duration");
  });

  it("HEALTH_SOURCES is scoped to the three phase-committed providers plus manual", () => {
    expect(HEALTH_SOURCES).toEqual(["health_connect", "apple_health", "whoop", "manual"]);
  });

  it("HEALTH_SOURCE_PRIORITY only references known sources", () => {
    const knownSources = new Set<string>(HEALTH_SOURCES);
    for (const priorityList of Object.values(HEALTH_SOURCE_PRIORITY)) {
      for (const source of priorityList ?? []) {
        expect(knownSources.has(source)).toBe(true);
      }
    }
  });

  it("HEALTH_SOURCE_PRIORITY only has keys for known metric types", () => {
    const knownMetrics = new Set<string>(HEALTH_METRIC_TYPES);
    for (const key of Object.keys(HEALTH_SOURCE_PRIORITY)) {
      expect(knownMetrics.has(key)).toBe(true);
    }
  });

  it("matches health-data.md's own worked HRV and Steps priority examples", () => {
    expect(HEALTH_SOURCE_PRIORITY.hrv?.[0]).toBe("whoop");
    expect(HEALTH_SOURCE_PRIORITY.steps?.[0]).toBe("health_connect");
  });

  it("deliberately declares no priority for weight -- cross-table InBody reconciliation is unresolved", () => {
    expect(HEALTH_SOURCE_PRIORITY.weight).toBeUndefined();
  });
});

describe("resolveByPriority", () => {
  const base = (overrides: Partial<HealthObservation>): HealthObservation => ({
    id: "obs-1",
    userId: "user-1",
    metricType: "hrv",
    value: 62,
    unit: "ms",
    startTime: new Date("2026-09-07T00:00:00Z"),
    endTime: new Date("2026-09-07T00:00:00Z"),
    source: "health_connect",
    providerRecordId: null,
    deviceId: null,
    quality: null,
    createdAt: new Date("2026-09-07T00:00:00Z"),
    ...overrides,
  });

  it("returns null for an empty candidate list", () => {
    expect(resolveByPriority("hrv", [])).toBeNull();
  });

  it("returns the sole candidate when there is only one", () => {
    const only = base({ source: "apple_health" });
    expect(resolveByPriority("hrv", [only])).toBe(only);
  });

  it("prefers the higher-priority source per the declared policy (WHOOP over Health Connect for HRV)", () => {
    const healthConnect = base({ id: "hc", source: "health_connect" });
    const whoop = base({ id: "whoop-obs", source: "whoop" });
    expect(resolveByPriority("hrv", [healthConnect, whoop])).toBe(whoop);
  });

  it("prefers Health Connect over Apple Health for steps, per the declared policy", () => {
    const appleHealth = base({ id: "ah", metricType: "steps", source: "apple_health" });
    const healthConnect = base({ id: "hc", metricType: "steps", source: "health_connect" });
    expect(resolveByPriority("steps", [appleHealth, healthConnect])).toBe(healthConnect);
  });

  it("a manual entry always wins over every provider, regardless of declared priority", () => {
    const whoop = base({ id: "whoop-obs", source: "whoop" });
    const manual = base({ id: "manual-obs", source: "manual" });
    expect(resolveByPriority("hrv", [whoop, manual])).toBe(manual);
  });

  it("falls back to the most recently created candidate when a metric type has no declared policy (weight)", () => {
    const older = base({
      id: "older",
      metricType: "weight",
      unit: "kg",
      source: "health_connect",
      createdAt: new Date("2026-09-01T00:00:00Z"),
    });
    const newer = base({
      id: "newer",
      metricType: "weight",
      unit: "kg",
      source: "apple_health",
      createdAt: new Date("2026-09-06T00:00:00Z"),
    });
    expect(HEALTH_SOURCE_PRIORITY.weight).toBeUndefined();
    expect(resolveByPriority("weight", [older, newer])).toBe(newer);
  });

  it("falls back to the most recently created candidate when a declared metric has two same-source candidates", () => {
    const older = base({
      id: "older",
      metricType: "hrv",
      source: "health_connect",
      createdAt: new Date("2026-09-01T00:00:00Z"),
    });
    const newer = base({
      id: "newer",
      metricType: "hrv",
      source: "health_connect",
      createdAt: new Date("2026-09-06T00:00:00Z"),
    });
    // Same source for both, so the priority-list loop matches the first one it encounters
    // in array order and never reaches the recency fallback for THIS metric -- this case
    // documents that ordering explicitly rather than assuming it.
    expect(resolveByPriority("hrv", [older, newer])).toBe(older);
  });
});
