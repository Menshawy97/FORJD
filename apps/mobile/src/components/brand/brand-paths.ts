/**
 * The FORJD identity's geometry (ADR-052), copied verbatim from the FORJD Logo canvas so
 * every brand component draws from one source. Paths only: colours come from the callers.
 */

/** The symbol, viewBox 0 0 100 100. */
export const SYMBOL_PATH =
  'M8 8H60V24H24V42H60V58H24V92H8ZM64.5 8H92V66A26 26 0 0 1 66 92H40V76H66A10 10 0 0 0 76 66V24H64.5Z';

/**
 * The symbol split into the four pieces animation #3 pulses, in the canvas's firing order.
 * The canvas draws the first three as <rect>s; they are the same rectangles as paths here so
 * the loader renders one element type.
 */
export const PULSE_PIECES = [
  { key: 'stem', d: 'M8 24H24V92H8Z' },
  { key: 'top', d: 'M8 8H60V24H8Z' },
  { key: 'mid', d: 'M24 42H60V58H24Z' },
  { key: 'j', d: 'M64.5 8H92V66A26 26 0 0 1 66 92H40V76H66A10 10 0 0 0 76 66V24H64.5Z' },
] as const;

/** The wordmark, viewBox 0 0 544 100. `evenodd` marks the counters (O, R's bowl, D). */
export const WORDMARK_VIEWBOX = { width: 544, height: 100 } as const;
export const WORDMARK_PATHS: ReadonlyArray<{ d: string; evenOdd?: true }> = [
  { d: 'M0 0H70V16H16V42H56V58H16V100H0Z' },
  {
    d: 'M128 0H168A30 30 0 0 1 198 30V70A30 30 0 0 1 168 100H128A30 30 0 0 1 98 70V30A30 30 0 0 1 128 0ZM128 16H168A14 14 0 0 1 182 30V70A14 14 0 0 1 168 84H128A14 14 0 0 1 114 70V30A14 14 0 0 1 128 16Z',
    evenOdd: true,
  },
  { d: 'M226 0H242V100H226Z' },
  { d: 'M226 0H288A26 26 0 0 1 314 26V32A26 26 0 0 1 288 58H226ZM242 16H288A10 10 0 0 1 298 26V32A10 10 0 0 1 288 42H242Z', evenOdd: true },
  { d: 'M272 50H292L316 100H296Z' },
  { d: 'M354 0H424V70A30 30 0 0 1 394 100H344V84H394A14 14 0 0 0 408 70V16H354Z' },
  { d: 'M452 0H514A30 30 0 0 1 544 30V70A30 30 0 0 1 514 100H452ZM468 16H514A14 14 0 0 1 528 30V70A14 14 0 0 1 514 84H468Z', evenOdd: true },
];

/** The canvas palette's two colours the app does not already carry as tokens. */
export const BRAND_BONE = '#EDEBE6';
export const BRAND_GRAPHITE = '#1B1B1D';
