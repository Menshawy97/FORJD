import { defineBackgroundUpload } from '@/integrations/background/background-upload';
import { syncPendingSessions } from '@/workouts/sync-sessions';

/**
 * Phase 12C: defines the background upload's task. Imported first by the app's entry file
 * (`apps/mobile/index.ts`), not by a route file: expo-router loads route modules lazily, so a
 * background wake-up that never renders the app would not evaluate `app/_layout.tsx`, and
 * TaskManager unregisters a task it finds undefined. It runs the same drain every foreground
 * trigger uses.
 */
defineBackgroundUpload(syncPendingSessions);
