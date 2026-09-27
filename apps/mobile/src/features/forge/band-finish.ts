import type { ForgeBand } from '@forjd/domain';

import { colors } from '@/theme/tokens';

/**
 * Each Weekly Forge band's "Heat" finish, as approved in the Phase 7 mock-ups
 * (docs/product/weekly-forge-plan.md, "Phase 7 outcome"): the colours steel glows as it heats.
 *
 * - `main` fills the Hallmark badge (at 16%); `light` draws its outline, icon and dots, and the
 *   Home card's progress rail.
 * - `dots` is the band's place on the ladder, drawn under the icon, so the band reads without
 *   relying on colour.
 * - `glow` is Forged's alone.
 */
export interface BandFinish {
  main: string;
  light: string;
  dots: number;
  glow: { color: string; opacity: number } | null;
}

export const BAND_FINISH: Record<ForgeBand, BandFinish> = {
  ore: { main: colors.forgeHeatOre, light: colors.forgeHeatOreLight, dots: 1, glow: null },
  ember: { main: colors.forgeHeatCherry, light: colors.forgeHeatCherryLight, dots: 2, glow: null },
  anvil: { main: colors.accent, light: colors.accentHover, dots: 3, glow: null },
  tempered: { main: colors.forgeHeatYellow, light: colors.forgeHeatYellowLight, dots: 4, glow: null },
  forged: {
    main: colors.forgeHeatWhite,
    light: colors.onAccent,
    dots: 5,
    glow: { color: colors.forgeHeatWhite, opacity: 0.55 },
  },
};
