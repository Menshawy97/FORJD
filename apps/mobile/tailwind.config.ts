import type { Config } from 'tailwindcss';

// Every value below is transcribed from
// `FORJD mobile app design/design_handoff_forjd_mobile/02-design-tokens.md`, which is itself
// measured out of the design prototype (FORJD Mobile.dc.html). Per ADR-010, write exact
// values here — no derived/seeded theme. Add a new token to this file (and to
// 02-design-tokens.md if it isn't already listed there) rather than inlining a hex/px value
// at a call site.
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
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
        // The tab bar's own translucent ground, from the prototype's `tabbar()` helper.
        tabBarBg: 'rgba(14,14,15,.96)',
        // The toast pill's ground, from the prototype's `flash()` render.
        toastBg: 'rgba(28,29,32,.97)',
        // The dimming layer the prototype lays behind its modal sheets.
        scrim: 'rgba(10,10,11,.72)',
        // The warm end of the Go Pro banner's 135deg gradient; the cool end is `surface`.
        proBanner: '#1C1408',
        // The fill a ghost control takes while held — `btn('ghost')`'s hover state.
        pressedGhost: 'rgba(255,255,255,.04)',
        // The exercise-detail header's icon buttons (pencil/star) hover fill --
        // docs/design/phase2-screen-specs.md §4.1: "hover rgba(255,255,255,.06)".
        iconButtonPressedBg: 'rgba(255,255,255,.06)',
        // The exercise-detail header's delete icon hover fill (§4.1: "hover
        // rgba(201,80,60,.14)") -- the same rgb triple as `destructive` below, at a lower alpha.
        destructivePressedBg: 'rgba(201,80,60,.14)',
        // A selected goals/activities pick-row's fill (goals.tsx), from the prototype's
        // selected pick-row style.
        pickRowSelectedBg: 'rgba(233,113,47,.1)',
        // The "How to train it" tip callout's fill.
        trainingTipBg: 'rgba(233,113,47,.08)',
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
        // The exercise-detail equipment pill's outline (§4.2: "border 1px solid
        // rgba(233,113,47,.25)") -- between `pickRowSelectedBg`'s .1 fill and `borderPro`'s .35.
        equipmentPillBorder: 'rgba(233,113,47,.25)',
        // The "How to train it" tip callout's outline -- a real `s_exercise()` element
        // (line 1971 of the prototype) missed during Phase J's first spec-extraction pass.
        trainingTipBorder: 'rgba(233,113,47,.2)',
        // A selected goals/activities pick-row's outline (goals.tsx) — a stronger accent
        // alpha than `borderPro`, from the prototype's selected pick-row style.
        borderPickRowSelected: 'rgba(233,113,47,.45)',
        // The athlete screen's initials-avatar tile outline, from the prototype's
        // `s_athlete()`. Not `borderPro` (.35) — a different, close-but-not-equal alpha.
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
        // The nutrition summary card's Carbs macro bar -- flagged in nutrition-screen-specs.md
        // §7 as a colour the prototype uses (`#6f9ac9`) with no token of its own until now.
        nutritionCarbs: '#6F9AC9',
        // Protein's macro colour -- used to be `accent`, but accent is also the calorie
        // ring's colour, and the two need to read as distinct rings once they're nested
        // (Home, the nutrition dashboard, and the share card all draw calories/protein/
        // carbs/fat as concentric rings). Applied everywhere protein is drawn: this ring,
        // the macro-dot legends, `MacroBar`, and the share card.
        protein: '#C98AD9',
        // The share card's Daily Summary ring track -- `rgba(255,255,255,.1)`, a different
        // alpha than the app-wide `ringTrack` (.08) and `nutrition.tsx`'s solid
        // `restRingTrack`. All three pre-existed as distinct per-screen values before the
        // rings were shared; this is the one of the three that had no name yet.
        shareRingTrack: 'rgba(255,255,255,.1)',
        readinessLabel: '#8BBF96',
        destructive: '#C9503C',
        errorText: '#E05A3C',
        deleteAccountRow: '#E05C5C',
        welcomeFeature: '#D8B79C',
        // The "How to train it" tip callout's body text -- close to but distinct from
        // `welcomeFeature` above (#D8B79C vs #D8B39A).
        trainingTipText: '#D8B39A',
        weekScoreLabel: '#C9906C',
        metricSleep: '#8FB4C9',
        badgeGold: '#C9A03C',

        // Home dashboard (the prototype's `isHome` branch, lines 130-283). The readiness
        // card is the only surface in the app painted on a green ground rather than the
        // neutral `surface`, so its gradient ends, outline, chip fill and two text colours
        // are all values that appear nowhere else.
        readinessCardFrom: '#16221A',
        readinessCardTo: '#141A16',
        borderReadiness: 'rgba(121,185,138,.22)',
        readinessChipBg: 'rgba(121,185,138,.12)',
        readinessChipText: '#A8D1B0',
        readinessBody: '#88A88F',
        // The unfilled remainder of a progress ring -- the readiness ring and the Nutrition
        // Today ring both draw their track in it.
        ringTrack: 'rgba(255,255,255,.08)',
        // The rounded accent tile behind the Insight bolt and the Recent PR star.
        accentTileBg: 'rgba(233,113,47,.13)',
        // The darkened tile holding the arrow inside the accent "Start Workout" button --
        // black at low alpha over the accent, not a colour of its own.
        ctaArrowTileBg: 'rgba(0,0,0,.22)',
        // "This week": the rail behind the progress fill, and a day bar's partial state. A
        // rest day reuses `tagBg`, which is already this exact value.
        weekRailTrack: '#1E1F21',
        weekBarPartial: 'rgba(233,113,47,.2)',
        // The strip that opens under the four metric cells when one is tapped.
        tooltipStripBg: 'rgba(255,255,255,.02)',
        // Text on the accent CTA. The one place the app paints pure white -- `text` (#F6F5F3)
        // is the off-white used everywhere else, and the prototype is explicit about `#fff`
        // here.
        onAccent: '#FFFFFF',
      },
      fontFamily: {
        // Archivo is a variable font; weight is selected via the `wght` axis (see
        // fontWeight below), never a static family name per weight.
        archivo: ['Archivo', 'sans-serif'],
      },
      fontSize: {
        'welcome-headline': ['34px', { lineHeight: '1.14', letterSpacing: '-.03em' }],
        'auth-headline': ['27px', { lineHeight: '1.15', letterSpacing: '-.02em' }],
        'screen-header': ['26px', { lineHeight: '1.15', letterSpacing: '-.02em' }],
        // `font:'700 19px/1 Archivo'` in the prototype — the `/1` is the line height.
        'profile-name': ['19px', { lineHeight: '1', letterSpacing: '-.01em' }],
        'hero-numeral': ['46px', { lineHeight: '1', letterSpacing: '-.03em' }],
        'stat-numeral': ['25px', { lineHeight: '1', letterSpacing: '-.02em' }],
        'stat-unit': '11.5px',
        'card-title': ['15.5px', { lineHeight: '1.2' }],
        'row-title': ['14.5px', { lineHeight: '1.25' }],
        'row-subtitle': ['12px', { lineHeight: '1.3' }],
        body: ['13.5px', { lineHeight: '1.4' }],
        'insight-body': ['13px', { lineHeight: '1.475' }],
        'section-label': ['9.5px', { lineHeight: '1', letterSpacing: '.14em' }],
        'metric-label': ['9px', { lineHeight: '1', letterSpacing: '.10em' }],
        button: ['15.5px', { lineHeight: '1', letterSpacing: '.01em' }],
        input: '14.5px',
        link: ['12.5px', { lineHeight: '1' }],
        chip: ['12.5px', { lineHeight: '1' }],
        'tab-label': ['10px', { lineHeight: '1' }],
        'inline-error': ['12px', { lineHeight: '1' }],
        legal: ['11.5px', { lineHeight: '1.5' }],
        wordmark: ['22px', { lineHeight: '1', letterSpacing: '.02em' }],
        // The welcome screen sits at the top of the handoff's 21-23px wordmark range.
        'wordmark-welcome': ['23px', { lineHeight: '1', letterSpacing: '.02em' }],
        'chart-axis': ['10px', { lineHeight: '1' }],
        // Values below are measured off the prototype and are not (yet) named in
        // 02-design-tokens.md's typography table — they are added here rather than inlined
        // at the call site, per the note at the top of this file.
        'welcome-sub': ['14px', { lineHeight: '1.5' }],
        'welcome-feature': ['12.8px', { lineHeight: '1.3' }],
        'field-hint': ['11px', { lineHeight: '1.4' }],
        'profile-handle': ['12px', { lineHeight: '1' }],
        // The Go Pro banner's label — `font:'700 13.5px/1.3 Archivo'`. Its pill reuses
        // `chip` (12.5px/1), which is already the same measurement.
        'pro-label': ['13.5px', { lineHeight: '1.3' }],
        // The toast pill's label — `font:'600 13px/1 Archivo'`.
        toast: ['13px', { lineHeight: '1' }],
        logout: ['13px', { lineHeight: '1' }],
        'plan-badge': ['10px', { lineHeight: '1', letterSpacing: '.03em' }],

        // Home dashboard. The wordmark is 21px here, one pixel under the 22px `wordmark`
        // the auth screens use -- a real difference in the prototype, not a rounding of it.
        'wordmark-home': ['21px', { lineHeight: '1', letterSpacing: '.02em' }],
        // The greeting under the wordmark and the date line above the first card.
        'home-meta': ['12.5px', { lineHeight: '1' }],
        // Home's small caption size, shared by the stat labels, the metric units, the macro
        // chips on the nutrition card, the readiness chips and the weekday letters.
        'home-caption': ['10.5px', { lineHeight: '1' }],
        'readiness-score': ['22px', { lineHeight: '1', letterSpacing: '-.02em' }],
        'readiness-ring-label': ['8px', { lineHeight: '1', letterSpacing: '.1em' }],
        'readiness-value': ['14px', { lineHeight: '1' }],
        'readiness-body': ['11px', { lineHeight: '1.3' }],
        'home-stat-numeral': ['20px', { lineHeight: '1' }],
        'home-stat-unit': ['11px', { lineHeight: '1' }],
        'home-metric-value': ['15px', { lineHeight: '1', letterSpacing: '-.01em' }],
        // The nutrition card's "0 / 2400 kcal" -- the same 15px as a metric value but with
        // no negative tracking, which is what the prototype specifies.
        'nutrition-card-value': ['15px', { lineHeight: '1' }],
        'cta-title': ['19px', { lineHeight: '1', letterSpacing: '-.01em' }],
        tooltip: ['11.5px', { lineHeight: '1.4' }],
        'week-count': ['12px', { lineHeight: '1' }],
        'pr-title': ['14.5px', { lineHeight: '1' }],
        'pr-meta': ['11.5px', { lineHeight: '1' }],
        'pr-value': ['18px', { lineHeight: '1' }],
      },
      spacing: {
        'screen-x': '22px',
        // The welcome screen is the one screen with a wider gutter than the 22px standard.
        'welcome-x': '32px',
        'statusbar-x': '26px',
        'card-interior': '16px',
        'row-y': '14px',
        'card-gap': '12px',
        'field-gap': '16px',
        'chip-gap': '10px',
        'section-gap': '24px',
      },
      borderRadius: {
        chip: '9px',
        field: '11px',
        button: '12px',
        card: '14px',
        hero: '16px',
        pill: '999px',
      },
      boxShadow: {
        'primary-button': '0 6px 22px rgba(233,113,47,.22)',
        'accent-hero-card': '0 8px 26px rgba(233,113,47,.20)',
        toast: '0 10px 30px rgba(0,0,0,.50)',
        'selected-segment': '0 1px 3px rgba(0,0,0,.40)',
        'fab-action': '0 6px 18px rgba(233,113,47,.25)',
      },
      // Android has no CSS shadow model — NativeWind's `getElevation()` maps each `boxShadow`
      // key to an Android `elevation` here, keyed identically. Without an entry it falls back
      // to scraping the key's blur radius as a raw elevation number (22 for `primary-button`),
      // which renders as a heavy hard black shadow, not the soft translucent orange glow the
      // design specifies. These values are deliberate, chosen for visual weight relative to
      // each other, not derived from the blur radius above.
      elevation: {
        'primary-button': 4,
        'accent-hero-card': 5,
        toast: 8,
        'selected-segment': 1,
        'fab-action': 6,
      },
    },
  },
  plugins: [],
} satisfies Config;
