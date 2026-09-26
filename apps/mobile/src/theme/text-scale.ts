/**
 * How far text drawn with `lineHeight` equal to its `fontSize` (the prototype's `/1`) may grow
 * with the system text size (8.5 S8, L8-4). Those texts sit in boxes sized to the design, so
 * unbounded growth clips or spills them; the user chose (2026-09-26) to keep the design's
 * spacing exactly and cap these texts only. Everything else in the app scales freely.
 */
export const TIGHT_TEXT_MAX_FONT_SCALE = 1.3;
