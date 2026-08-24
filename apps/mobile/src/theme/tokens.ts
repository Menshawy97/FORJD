// Typed re-export of the design tokens for call sites that need a raw value rather than a
// NativeWind className — e.g. react-native-svg icon `fill`/`stroke` props, which take a
// color string, not a class. `tailwind.config.ts` is the source of truth; keep these two
// files in sync manually (there is no single-source generation step yet) — the test in
// `__tests__/tokens.test.ts` is the guard against them drifting apart.
//
// Values transcribed from
// `FORJD mobile app design/design_handoff_forjd_mobile/02-design-tokens.md`. Per ADR-010,
// write exact values here — no derived/seeded theme.
export const colors = {
  // Surfaces
  bg: '#08090A',
  screenBg: '#101011',
  surface: '#17181A',
  fieldBg: '#151517',
  elevated: '#191A1C',
  elevated2: '#1C1D20',
  elevated3: '#232326',
  trackBg: '#141416',
  setRowBg: '#141517',
  tagBg: '#1B1C1E',
  stepperBg: '#232427',
  stepperBgHover: '#2C2D31',
  barTrack: '#26272A',
  restAdjustBg: '#1A1B1D',
  restRingTrack: '#1E1F22',
  toggleTrackOff: '#2A2A2E',
  // The tab bar's own translucent ground, from the prototype's `tabbar()` helper
  // (`background:rgba(14,14,15,.96)` behind a 12px blur).
  tabBarBg: 'rgba(14,14,15,.96)',
  // The toast pill's ground, from the prototype's `flash()` render.
  toastBg: 'rgba(28,29,32,.97)',
  // The dimming layer the prototype lays behind its modal sheets.
  scrim: 'rgba(10,10,11,.72)',
  // The warm end of the Go Pro banner's 135deg gradient; the cool end is `surface`.
  proBanner: '#1C1408',
  // The fill a ghost control takes while held — the prototype's `btn('ghost')` hover state.
  pressedGhost: 'rgba(255,255,255,.04)',
  // A selected goals/activities pick-row's fill (goals.tsx), from the prototype's selected
  // pick-row style.
  pickRowSelectedBg: 'rgba(233,113,47,.1)',
  // The athlete screen's initials-avatar tile fill, from the prototype's `s_athlete()`.
  athleteAvatarBg: 'rgba(233,113,47,.14)',

  // Borders
  border: 'rgba(255,255,255,.07)',
  borderFaint: 'rgba(255,255,255,.05)',
  borderCell: 'rgba(255,255,255,.06)',
  // The profile plan badge's outline, from the prototype's `profilePlanStyle`.
  borderBadge: 'rgba(255,255,255,.08)',
  // The Go Pro banner's accent outline.
  borderPro: 'rgba(233,113,47,.35)',
  // A selected goals/activities pick-row's outline (goals.tsx) — a stronger accent alpha
  // than `borderPro`, from the prototype's selected pick-row style.
  borderPickRowSelected: 'rgba(233,113,47,.45)',
  // The athlete screen's initials-avatar tile outline, from the prototype's `s_athlete()`.
  // Not `borderPro` (.35) — a different, close-but-not-equal alpha.
  borderAthleteAvatar: 'rgba(233,113,47,.28)',
  // The toast pill's outline, from the prototype's `flash()` render.
  borderToast: 'rgba(255,255,255,.1)',
  // A goals/activities pick-row checkbox's unselected ring (goals.tsx).
  borderCheckbox: '#37383C',
  errorBorder: '#B8422F',

  // Text
  text: '#F6F5F3',
  insightBody: '#E4E2DE',
  textSecondary: '#C8C8C0',
  textTertiary: '#B4B4AC',
  tooltipBody: '#A9A9A1',
  dim: '#9A9A92',
  metadata: '#8B8B83',
  segmentedInactive: '#7E7E77',
  label: '#77776F',
  dimmer: '#6E6E66',
  tabInactive: '#6B6B64',
  placeholder: '#5D5D57',
  legal: '#5C5C55',
  restDayLetter: '#4D4D47',

  // Accent and semantic
  accent: '#E9712F',
  accentHover: '#F4894C',
  accentDark: '#A84D1D',
  green: '#79B98A',
  readinessLabel: '#8BBF96',
  destructive: '#C9503C',
  errorText: '#E05A3C',
  deleteAccountRow: '#E05C5C',
  welcomeFeature: '#D8B79C',
  weekScoreLabel: '#C9906C',
  metricSleep: '#8FB4C9',
  badgeGold: '#C9A03C',
} as const;

export type ColorToken = keyof typeof colors;
