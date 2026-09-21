import { averageHeartRate } from '@forjd/domain';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { useToast } from '@/components/toast';
import {
  getPrecisePermission,
  requestPrecisePermission,
  watchPrecisePosition,
  type PreciseFix,
} from '@/integrations/location/location-provider';
import type { SqliteConnection } from '@/store/exercise-catalogue';
import { readLocationConsent } from '@/store/leaderboard-consent';
import { clearRunSnapshot, ensureRunSessionSchema, getUnfinishedRunSnapshot, saveRunSnapshot } from '@/store/run-session';
import { enqueueSessionUpload, openWorkoutSessionDb } from '@/store/workout-session';
import {
  MIN_SAVEABLE_RUN_METERS,
  addFix,
  finishRun,
  isRunWorthSaving,
  pauseRun,
  resumeRun,
  runStats,
  startRun,
  toRunUploadRequest,
  type RunState,
} from '@/workouts/live-run';
import { setCompletedRun } from '@/workouts/run-handoff';
import { newSessionId } from '@/workouts/start-session';
import { syncPendingSessions } from '@/workouts/sync-sessions';

import { gpsQuality, type GpsQuality } from './gps-quality';
import { fetchLatestWeightKg } from './latest-weight';
import { restoreRunSnapshot, toRunSnapshot } from './run-snapshot';
import { toRunSummary } from './run-summary';

/**
 * Everything the live run screen does that is not drawing (ADR-049, ADR-050): starting or recovering
 * a run, asking for precise location, following the position, keeping the recovery snapshot, and
 * finishing into the upload queue. The screen stays a picture of `RunSession`.
 *
 * The run is a `RunState` from the pure engine, held in a ref as well as in React state so a reading
 * that arrives between renders is applied to the latest run rather than a stale closure.
 *
 * **The network is never in the critical path** (CLAUDE.md rule 6): starting, pausing and finishing
 * touch only the phone. The one network read, the body weight for the calorie estimate, is bounded
 * and its failure just means no estimate.
 */
export type RunPermission = 'checking' | 'granted' | 'denied' | 'coarse_only' | 'unavailable';

const TICK_MS = 1000;
/** How often a running run is written to the recovery snapshot, besides on pause and finish. */
const AUTOSAVE_MS = 10_000;
/** How many recent heart-rate samples the live sparkline draws. */
const HEART_RATE_POINTS = 60;

export interface RunSplitView {
  index: number;
  durationSeconds: number;
  avgHeartRateBpm: number | null;
}

export interface RunSession {
  ready: boolean;
  status: RunState['status'];
  permission: RunPermission;
  quality: GpsQuality;
  autoPaused: boolean;
  isFinishing: boolean;
  stats: ReturnType<typeof runStats> | null;
  splits: RunSplitView[];
  heartRate: { currentBpm: number | null; averageBpm: number | null; series: number[] };
  toast: ReturnType<typeof useToast>;
  pause: () => void;
  resume: () => void;
  finish: () => void;
  confirmDiscard: () => void;
}

export function useRunSession(): RunSession {
  const [run, setRun] = useState<RunState | null>(null);
  const runRef = useRef<RunState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [permission, setPermission] = useState<RunPermission>('checking');
  const [lastAccuracy, setLastAccuracy] = useState<{ meters: number | null } | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const toast = useToast();
  // `toast` is a new object each render; only its `show` is stable, so that is what callbacks depend on.
  const showToast = toast.show;

  const dbRef = useRef<Promise<SqliteConnection> | null>(null);
  const stopWatchRef = useRef<(() => void) | null>(null);
  const finishingRef = useRef(false);
  const closedRef = useRef(false);
  const saveWarnedRef = useRef(false);

  const getDb = useCallback((): Promise<SqliteConnection> => {
    if (!dbRef.current) {
      dbRef.current = (async () => {
        const db = await openWorkoutSessionDb();
        await ensureRunSessionSchema(db);
        return db;
      })();
    }
    return dbRef.current;
  }, []);

  const commit = useCallback((next: RunState) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const persist = useCallback(
    async (state: RunState) => {
      if (closedRef.current) return;
      try {
        const db = await getDb();
        await saveRunSnapshot(db, state.id, toRunSnapshot(state, Date.now()), new Date(state.startedAtMs).toISOString());
      } catch {
        // Recovery is best effort, but a runner who would lose the run to a crash should know.
        if (!saveWarnedRef.current) {
          saveWarnedRef.current = true;
          showToast('Progress is not being saved — closing the app would lose this run.');
        }
      }
    },
    [getDb, showToast],
  );

  const stopWatching = useCallback(() => {
    stopWatchRef.current?.();
    stopWatchRef.current = null;
  }, []);

  // Recover an unfinished run or start a new one, then ask for location and follow the position.
  useEffect(() => {
    let cancelled = false;

    const onFix = (fix: PreciseFix) => {
      const current = runRef.current;
      if (!current || closedRef.current) return;
      setLastAccuracy({ meters: fix.accuracyMeters });
      commit(addFix(current, fix));
    };

    void (async () => {
      let recovered: RunState | null = null;
      try {
        const snapshot = await getUnfinishedRunSnapshot(await getDb());
        recovered = snapshot ? restoreRunSnapshot(snapshot.payload) : null;
      } catch {
        // No readable snapshot: start a fresh run rather than refuse to run.
      }
      if (cancelled) return;
      const initial = recovered ?? startRun(newSessionId(), Date.now());
      commit(initial);
      void persist(initial);

      let granted = await getPrecisePermission();
      if (cancelled) return;
      // Asked here, once, because the person just tapped Start a run (ADR-049 #3).
      if (granted === 'undetermined') {
        granted = await requestPrecisePermission();
        if (cancelled) return;
      }
      if (granted !== 'granted') {
        setPermission(granted === 'coarse_only' || granted === 'unavailable' ? granted : 'denied');
        return;
      }

      const watch = await watchPrecisePosition(onFix, { isCancelled: () => cancelled });
      if (cancelled) {
        if (watch.status === 'watching') watch.stop();
        return;
      }
      if (watch.status === 'watching') {
        stopWatchRef.current = watch.stop;
        setPermission('granted');
      } else if (watch.status !== 'cancelled') {
        setPermission(watch.status);
      }
    })();

    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [commit, getDb, persist, stopWatching]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const current = runRef.current;
      if (current && current.status === 'running') void persist(current);
    }, AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [persist]);

  const pause = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    const next = pauseRun(current, Date.now());
    commit(next);
    void persist(next);
  }, [commit, persist]);

  const resume = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    setAutoPaused(false);
    const next = resumeRun(current, Date.now());
    commit(next);
    void persist(next);
  }, [commit, persist]);

  // Foreground location stops when the phone locks (ADR-049 #2), so the run pauses with it and says why.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'background') return;
      const current = runRef.current;
      if (current?.status !== 'running') return;
      setAutoPaused(true);
      const next = pauseRun(current, Date.now());
      commit(next);
      void persist(next);
    });
    return () => subscription.remove();
  }, [commit, persist]);

  const discard = useCallback(async () => {
    const current = runRef.current;
    closedRef.current = true;
    stopWatching();
    if (current) {
      try {
        await clearRunSnapshot(await getDb(), current.id);
      } catch {
        // An orphaned snapshot is offered back next time; discarding must still leave the screen.
      }
    }
    router.back();
  }, [getDb, stopWatching]);

  const confirmDiscard = useCallback(() => {
    Alert.alert('Discard this run?', 'Your run so far will be deleted. This cannot be undone.', [
      { text: 'Keep running', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discard() },
    ]);
  }, [discard]);

  const finish = useCallback(() => {
    const current = runRef.current;
    if (!current || finishingRef.current) return;
    const endedAt = Date.now();
    const finished = finishRun(current, endedAt);
    const stats = runStats(finished, endedAt);

    if (!isRunWorthSaving(stats)) {
      Alert.alert(
        'Run too short to save',
        `You have covered less than ${MIN_SAVEABLE_RUN_METERS} m. Discard this run, or keep going?`,
        [
          { text: 'Keep going', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => void discard() },
        ],
      );
      return;
    }

    finishingRef.current = true;
    setIsFinishing(true);
    void (async () => {
      try {
        const db = await getDb();
        const [weightKg, startAllowed] = await Promise.all([fetchLatestWeightKg(), readLocationConsent()]);
        const request = toRunUploadRequest(finished, {
          weightKg,
          allowStartLocation: startAllowed === true,
          // Watch heart rate and its consent arrive with R8; until then nothing here is health data.
          healthDataAllowed: false,
          watchCaloriesKcal: null,
        });
        await enqueueSessionUpload(db, request);
        closedRef.current = true;
        try {
          await clearRunSnapshot(db, finished.id);
        } catch {
          // Queued already; a leftover snapshot for a finished id is harmless and cleared next time.
        }
        stopWatching();
        setCompletedRun(toRunSummary(request, stats.route));
        void syncPendingSessions();
        router.replace('/run-done');
      } catch {
        // Not queued: stay on the run, still running, so Finish can be tried again.
        finishingRef.current = false;
        setIsFinishing(false);
        showToast('Run not saved — try Finish again.');
      }
    })();
  }, [discard, getDb, showToast, stopWatching]);

  const stats = useMemo(() => (run ? runStats(run, nowMs) : null), [run, nowMs]);

  const splits = useMemo<RunSplitView[]>(
    () =>
      (stats?.splits ?? []).map((split) => ({
        index: split.index,
        durationSeconds: split.durationSeconds,
        avgHeartRateBpm: run ? averageHeartRate(run.heartRate, split.startTimestampMs, split.endTimestampMs) : null,
      })),
    [run, stats],
  );

  const heartRate = useMemo(() => {
    const samples = run?.heartRate ?? [];
    const last = samples[samples.length - 1];
    return {
      currentBpm: last ? last.bpm : null,
      averageBpm: run ? averageHeartRate(samples, run.startedAtMs, nowMs) : null,
      series: samples.slice(-HEART_RATE_POINTS).map((sample) => sample.bpm),
    };
  }, [run, nowMs]);

  return {
    ready: run !== null,
    status: run?.status ?? 'running',
    permission,
    quality: gpsQuality(lastAccuracy?.meters ?? null, lastAccuracy !== null),
    autoPaused,
    isFinishing,
    stats,
    splits,
    heartRate,
    toast,
    pause,
    resume,
    finish,
    confirmDiscard,
  };
}
