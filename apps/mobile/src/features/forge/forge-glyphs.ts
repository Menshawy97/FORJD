import type { ForgeLadder } from '@forjd/domain';

/**
 * The five icons stamped inside a Weekly Forge badge, as the user chose them in the Phase 7
 * mock-ups (docs/product/weekly-forge-plan.md, "Phase 7 outcome"): a streak flame, a loaded
 * barbell, a route with a pin, an energy bolt and an apple.
 *
 * They are drawn on the same 24 grid, at the same 1.6 stroke with round caps and joins, as the
 * app-wide set in `components/icon.tsx`, but they live here rather than there: they are Forge-only,
 * and the app's own glyphs (its calendar, dumbbell, shoe and clock) are left exactly as they are.
 */
export type ForgeGlyphShape =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

export const FORGE_GLYPHS: Record<ForgeLadder, readonly ForgeGlyphShape[]> = {
  consistency: [
    {
      kind: 'path',
      d: 'M12 3.4c.5 2.9 5 4.9 5 9.7a5 5 0 0 1-10 0c0-2.1 1-3.6 2.1-4.7.2 1.5 1.1 2.4 2 2.6-.5-3 .2-5.4.9-7.6z',
    },
    { kind: 'path', d: 'M12 20.4a2 2 0 0 1-2-2c0-1.2 1-2 2-3 1 1 2 1.8 2 3a2 2 0 0 1-2 2z' },
  ],
  volume: [
    { kind: 'rect', x: 5, y: 6, width: 3, height: 12, rx: 1 },
    { kind: 'rect', x: 16, y: 6, width: 3, height: 12, rx: 1 },
    { kind: 'rect', x: 2.4, y: 8.8, width: 2.6, height: 6.4, rx: 0.8 },
    { kind: 'rect', x: 19, y: 8.8, width: 2.6, height: 6.4, rx: 0.8 },
    { kind: 'path', d: 'M8 12h8' },
  ],
  distance: [
    { kind: 'circle', cx: 5.6, cy: 18.4, r: 1.6 },
    { kind: 'path', d: 'M7.2 18.2c3.2-.4 3.4-4 6.4-4.2 2-.1 3.4-.8 3.4-2.6' },
    { kind: 'path', d: 'M17 3.6a3.2 3.2 0 0 1 3.2 3.2c0 2.3-3.2 5.2-3.2 5.2s-3.2-2.9-3.2-5.2A3.2 3.2 0 0 1 17 3.6z' },
    { kind: 'circle', cx: 17, cy: 6.8, r: 0.9 },
  ],
  minutes: [{ kind: 'path', d: 'M13.4 3.4 6 13.2h5.4l-.8 7.4 7.4-9.8h-5.4z' }],
  nourish: [
    {
      kind: 'path',
      d: 'M12 8c-1.7-1.1-4.8-.9-6 1.4-1.5 2.7-.4 7.1 1.9 9.5 1.2 1.2 2.5 1.6 4.1.8 1.6.8 2.9.4 4.1-.8 2.3-2.4 3.4-6.8 1.9-9.5-1.2-2.3-4.3-2.5-6-1.4z',
    },
    { kind: 'path', d: 'M12 8c0-1.8.7-3.3 2.2-4.2' },
  ],
};
