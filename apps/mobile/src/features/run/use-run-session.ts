import { averageHeartRate } from '@forjd/domain';
import { getAccountId } from '@/auth/secureStorage';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler } from 'react-native';

import { useToast } from '@/components/toast';
import {
  getPrecisePermission,
  requestPrecisePermission,
  watchPrecisePosition,
  type PreciseFix,
} from '@/integrations/location/location-provider';
import type { SqliteConnection } from '@/store/exercise-catalogue';
import { getDeviceHealthProvider } from '@/integrations/health/device-health-provider';
import { readHealthConsent } from '@/store/health-consent-local';
import { readLocationConsent } from '@/store/leaderboard-consent';
import { hasAskedRunHealthAccess, markRunHealthAccessAsked } from '@/store/run-health-access';
import { clearRunSnapshot, ensureRunSessionSchema, getUnfinishedRunSnapshot, saveRunSnapshot } from '@/store/run-session';
import { enqueueSessionUpload, getQueuedSessions, openWorkoutSessionDb } from '@/store/workout-session';
import {
  MIN_SAVEABLE_RUN_METERS,
  addFix,
  addHeartRate,
  finishRun,
  isRunWorthSaving,
  pauseRun,
  resumeRun,
  runStats,
  runTrackStats,
  startRun,
  toRunUploadRequest,
  type RunState,
} from '@/workouts/live-run';
import { setCompletedRun } from '@/workouts/run-handoff';
import { newSessionId } from '@/workouts/start-session';
import { syncPendingSessions } from '@/workouts/sync-sessions';

import { gpsQuality, type GpsQuality } from './gps-quality';
import { fetchRunCalorieInputs } from './latest-weight';
import { HEART_RATE_POLL_MS, prepareRunHealth, readFinalHealth, type FinalHealth, type RunHealthReader } from './run-health';
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
  const healthRef = useRef<RunHealthReader | null>(null);
  const healthPromptOpenRef = useRef(false);

  const getDb = useCallback((): Promise<SqliteConnection> => {
    if (!dbRef.current) {
      dbRef.current = (async () => {
        const db = await openWorkoutSessionDb();
        await ensureRunSessionSchema(db);
        return db;
      })().catch((error: unknown) => {
        // Not cached: a failed open must be retried by the next call, not fail forever.
        dbRef.current = null;
        throw error;
      });
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
        await saveRunSnapshot(db, await getAccountId(), state.id, toRunSnapshot(state, Date.now()), new Date(state.startedAtMs).toISOString());
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

  const permissionRef = useRef<RunPermission>('checking');
  const unmountedRef = useRef(false);
  const updatePermission = useCallback((next: RunPermission) => {
    permissionRef.current = next;
    setPermission(next);
  }, []);

  const onFix = useCallback(
    (fix: PreciseFix) => {
      const current = runRef.current;
      if (!current || closedRef.current) return;
      setLastAccuracy({ meters: fix.accuracyMeters });
      setNowMs(Date.now());
      commit(addFix(current, fix));
    },
    [commit],
  );

  /** Back from Settings: if location is now allowed and nothing is being followed, follow it. */
  const recheckPermission = useCallback(async () => {
    if (closedRef.current || stopWatchRef.current || permissionRef.current === 'checking') return;
    if (permissionRef.current === 'granted') return;
    if ((await getPrecisePermission()) !== 'granted') return;
    const isCancelled = () => unmountedRef.current || closedRef.current;
    const watch = await watchPrecisePosition(onFix, { isCancelled });
    if (watch.status !== 'watching') return;
    if (isCancelled()) {
      watch.stop();
      return;
    }
    stopWatchRef.current = watch.stop;
    updatePermission('granted');
  }, [onFix, updatePermission]);

  // Recover an unfinished run or start a new one, then ask for location and follow the position.
  useEffect(() => {
    let cancelled = false;
    unmountedRef.current = false;

    void (async () => {
      let recovered: RunState | null = null;
      try {
        const db = await getDb();
        const snapshot = await getUnfinishedRunSnapshot(db, await getAccountId());
        recovered = snapshot ? restoreRunSnapshot(snapshot.payload, Date.now()) : null;
        // A snapshot left behind by a run that was in fact queued must not bring it back to life.
        if (recovered && (await getQueuedSessions(db)).some((row) => row.sessionId === recovered?.id)) {
          await clearRunSnapshot(db, recovered.id);
          recovered = null;
        }
        // Health data kept from before is dropped unless consent is still on (ADR-043): a recovered run
        // must not carry, show or re-save heart rate the person no longer allows.
        if (recovered && recovered.heartRate.length > 0 && (await readHealthConsent()) !== true) {
          recovered = { ...recovered, heartRate: [] };
        }
        if (snapshot && !recovered) {
          showToast('Your last run could not be restored, so this is a new run.');
        }
      } catch {
        // No readable snapshot: start a fresh run rather than refuse to run.
      }
      if (cancelled) return;
      const initial = recovered ?? startRun(newSessionId(), Date.now());
      commit(initial);
      void persist(initial);

      try {
        let granted = await getPrecisePermission();
        if (cancelled) return;
        // Asked here, once, because the person just tapped Start a run (ADR-049 #3).
        if (granted === 'undetermined') {
          granted = await requestPrecisePermission();
          if (cancelled) return;
        }
        if (granted !== 'granted') {
          updatePermission(granted === 'coarse_only' || granted === 'unavailable' ? granted : 'denied');
          return;
        }

        const watch = await watchPrecisePosition(onFix, { isCancelled: () => cancelled });
        if (cancelled) {
          if (watch.status === 'watching') watch.stop();
          return;
        }
        if (watch.status === 'watching') {
          stopWatchRef.current = watch.stop;
          updatePermission('granted');
        } else if (watch.status !== 'cancelled') {
          updatePermission(watch.status);
        }
      } catch {
        // Never leave the screen "checking" forever with a clock running and no GPS.
        if (!cancelled) updatePermission('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      unmountedRef.current = true;
      stopWatching();
    };
  }, [commit, getDb, onFix, persist, showToast, stopWatching, updatePermission]);

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

  // Watch heart rate (R8): only with health-data consent, asked of Health Connect once ever, polled
  // gently because watches sync in batches. A watch that is absent or silent is just a run without it.
  // It waits for the location question to settle, so the two system prompts never overlap.
  const isReady = run !== null && permission !== 'checking';
  useEffect(() => {
    if (!isReady) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async (reader: RunHealthReader) => {
      const current = runRef.current;
      if (!current || closedRef.current) return;
      try {
        const samples = await reader.readHeartRate(current.startedAtMs);
        const latest = runRef.current;
        if (!cancelled && latest && samples.length > 0) commit(addHeartRate(latest, samples));
      } catch {
        // A missed poll costs a few seconds of the chart, not the run.
      }
    };

    void (async () => {
      try {
        if ((await readHealthConsent()) !== true) return;
        const provider = getDeviceHealthProvider();
        if (!provider) return;
        // Health Connect's own screen sends the app to the background while it is open; that is not
        // the phone locking, so the run must not pause itself for it.
        healthPromptOpenRef.current = true;
        let reader: RunHealthReader | null;
        try {
          reader = await prepareRunHealth(provider, {
            alreadyAsked: await hasAskedRunHealthAccess(),
            markAsked: markRunHealthAccessAsked,
          });
        } finally {
          healthPromptOpenRef.current = false;
        }
        if (!reader || cancelled) return;
        healthRef.current = reader;
        await poll(reader);
        if (!cancelled) timer = setInterval(() => void poll(reader), HEART_RATE_POLL_MS);
      } catch {
        // Optional feature: nothing to tell the runner if there is no watch to read.
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [isReady, commit]);

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
      // Back from Settings: pick up a permission the person has just fixed.
      if (state === 'active') {
        void recheckPermission();
        return;
      }
      if (state !== 'background' || healthPromptOpenRef.current) return;
      const current = runRef.current;
      if (current?.status !== 'running') return;
      setAutoPaused(true);
      const next = pauseRun(current, Date.now());
      commit(next);
      void persist(next);
    });
    return () => subscription.remove();
  }, [commit, persist, recheckPermission]);

  const discard = useCallback(async () => {
    // A run already being saved cannot also be thrown away: the save would still queue it.
    if (finishingRef.current) return;
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
    if (finishingRef.current) return;
    Alert.alert('Discard this run?', 'Your run so far will be deleted. This cannot be undone.', [
      { text: 'Keep running', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discard() },
    ]);
  }, [discard]);

  // Android's back button and gesture ask the same question instead of silently ending the run.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmDiscard();
      return true;
    });
    return () => subscription.remove();
  }, [confirmDiscard]);

  const finish = useCallback(() => {
    const current = runRef.current;
    // Not while a discard is closing the run: the two must never both act on it.
    if (!current || finishingRef.current || closedRef.current) return;
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
        const noHealth: FinalHealth = { heartRate: [], caloriesKcal: null };
        const healthConsentRead = readHealthConsent();
        // The final watch read runs beside the weight lookup, so Finish waits for the slower, not both.
        const finalHealthRead = healthConsentRead.then((consent) =>
          consent === true ? readFinalHealth(healthRef.current, finished.startedAtMs, endedAt) : noHealth,
        );
        const [calorieInputs, startAllowed, healthConsent, finalHealth] = await Promise.all([
          fetchRunCalorieInputs(new Date(finished.startedAtMs)),
          readLocationConsent(),
          healthConsentRead,
          finalHealthRead,
        ]);
        const healthAllowed = healthConsent === true;
        const withHeartRate = healthAllowed ? addHeartRate(finished, finalHealth.heartRate) : finished;
        const request = toRunUploadRequest(withHeartRate, {
          ...calorieInputs,
          allowStartLocation: startAllowed === true,
          // Only an explicit yes reads or stores heart rate and the watch's calories (ADR-043).
          healthDataAllowed: healthAllowed,
          watchCaloriesKcal: healthAllowed ? finalHealth.caloriesKcal : null,
        });
        // Closed before the enqueue, so a late autosave cannot write the snapshot back afterwards.
        closedRef.current = true;
        const accountId = await getAccountId();
        // One transaction (G6): either the run is queued and its recovery snapshot gone, or neither
        // happened and the "not saved" path below lets the person try again. A crash between two
        // separate writes used to leave a snapshot of a queued run to be offered back later.
        await db.withTransactionAsync(async () => {
          await enqueueSessionUpload(db, accountId, request);
          await clearRunSnapshot(db, finished.id);
        });
        // From here the run is safely queued: nothing below may report it as "not saved".
        stopWatching();
        try {
          setCompletedRun(toRunSummary(request, stats.route));
        } catch {
          // The summary is a convenience; the run is queued either way.
        }
        void syncPendingSessions();
        router.replace('/run-done');
      } catch {
        // Not queued: stay on the run, still running, so Finish can be tried again.
        closedRef.current = false;
        finishingRef.current = false;
        setIsFinishing(false);
        showToast('Run not saved — try Finish again.');
      }
    })();
  }, [discard, getDb, showToast, stopWatching]);

  // The GPS-only part changes only when a reading arrives; the clock part every second.
  const fixes = run?.fixes;
  const trackStats = useMemo(() => (fixes ? runTrackStats(fixes) : null), [fixes]);
  const stats = useMemo(
    () => (run && trackStats ? runStats(run, nowMs, trackStats) : null),
    [run, nowMs, trackStats],
  );

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
      // Every sample since the start: `nowMs` can be a second stale, and a watch sample is never "future".
      averageBpm: run ? averageHeartRate(samples, run.startedAtMs, Number.MAX_SAFE_INTEGER) : null,
      series: samples.slice(-HEART_RATE_POINTS).map((sample) => sample.bpm),
    };
  }, [run]);

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
