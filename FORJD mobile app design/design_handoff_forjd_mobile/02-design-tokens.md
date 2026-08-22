# Design tokens

Every value below is measured out of `FORJD Mobile.dc.html`. The **Flutter** column is where
it already lives in `apps/mobile/lib/core/theme/`. A blank Flutter column is a **gap** — add
the token, do not inline the hex at the call site.

## Named constants in the prototype

The prototype's JS declares seven shorthand constants. Everything else is written inline.

```js
const O='#e9712f', GRN='#79b98a', W='#f6f5f3', DIM='#9a9a92',
      DIMMER='#6e6e66', CARD='#17181a', BRD='1px solid rgba(255,255,255,.07)';
```

## Colour — surfaces

| Hex | Role | Flutter |
|---|---|---|
| `#08090A` | page background (outside the phone) | `AppColors.bg` |
| `#101011` | screen background inside the frame | — *(add `screenBg`; `bg` is the desk, not the screen)* |
| `#17181A` | default card / panel fill | `AppColors.surface` |
| `#151517` | text-input fill (recessed) | `AppColors.fieldBg` |
| `#191A1C` | inactive chip fill | `AppColors.elevated` |
| `#1C1D20` | icon tile behind a list-row glyph | `AppColors.elevated2` |
| `#232326` | selected segment in a segmented control | `AppColors.elevated3` |
| `#141416` | segmented-control track | — *(add `trackBg`)* |
| `#141517` | live-workout set row, unticked | — *(add `setRowBg`)* |
| `#1B1C1E` | metadata tag pill | — *(add `tagBg`)* |
| `#232427` | stepper button; empty chart bar | — *(add `stepperBg`)* |
| `#26272A` | segmental-analysis bar track | — *(add `barTrack`)* |
| `#1A1B1D` | rest-timer ±adjust button | — |
| `#1E1F22` | rest-timer ring track | — |
| `#2A2A2E` | toggle track, off | — |
| `#2C2D31` | stepper button, hover | — |
| `rgba(28,29,32,.97)` | toast background | — *(add `toastBg`)* |
| `rgba(14,14,15,.96)` | tab bar behind a 12px blur | `AppColors.tabBarBg` |
| `rgba(10,10,11,.72)` | modal scrim | — *(add `scrim`)* |

## Colour — borders

| Value | Role | Flutter |
|---|---|---|
| `rgba(255,255,255,.07)` | hairline on cards, fields, tab bar | `AppColors.border` |
| `rgba(255,255,255,.05)` | divider between list rows | `AppColors.borderFaint` |
| `rgba(255,255,255,.06)` | divider inside a multi-cell card | — |
| `rgba(255,255,255,.13–.16)` | dashed "add" affordance | — |
| `rgba(233,113,47,.45)` | selected option card | — |
| `rgba(233,113,47,.50)` | dashed accent "+ New" | — |
| `#B8422F` | field border, error | `AppColors.errorBorder` |

## Colour — text

| Hex | Role | Flutter |
|---|---|---|
| `#F6F5F3` | primary | `AppColors.text` |
| `#E4E2DE` | insight body copy | — |
| `#C8C8C0` | secondary emphasis | — |
| `#B4B4AC` | tertiary / unselected option | — |
| `#A9A9A1` | tooltip body | — |
| `#9A9A92` | body / subhead | `AppColors.dim` |
| `#8B8B83` | metadata | — |
| `#7E7E77` | segmented label, unselected | — |
| `#77776F` | uppercase section label | `AppColors.label` |
| `#6E6E66` | dim metadata | `AppColors.dimmer` |
| `#6B6B64` | tab bar, inactive | `AppColors.tabInactive` |
| `#5D5D57` | input placeholder | `AppColors.placeholder` |
| `#5C5C55` | chart axis, legal | `AppColors.legal` |
| `#4D4D47` | rest-day letter in a week strip | — |

## Colour — accent and semantic

| Hex | Role | Flutter |
|---|---|---|
| `#E9712F` | accent — primary action, active tab, strength data | `AppColors.accent` |
| `#F4894C` | accent hover | `AppColors.accentHover` |
| `#A84D1D` | accent shade — third bar of the wordmark, ring gap | `AppColors.accentDark` |
| `#79B98A` | positive / recovery / completed set | `AppColors.green` |
| `#8BBF96` | label on the readiness card | — |
| `#88A88F`, `#7E9A85` | supporting copy on the readiness card | — |
| `#C9503C` | destructive (log out, delete, remove) | `AppColors.destructive` |
| `#E05A3C` | inline error text | `AppColors.errorText` |
| `#E05C5C` | "Delete account" row | — *(consolidate with `destructive`)* |
| `#D8B79C` | welcome-screen feature rows | `AppColors.welcomeFeature` |
| `#C9906C` | "Week score" label | — |
| `#8FB4C9` | sleep metric | — *(add `metricSleep`)* |
| `#C9A03C` | PB / streak badge | — *(add `badgeGold`)* |
| `#A08167`, `#A08A4E`, `#4F6F8A`, `#6D8F76` | muted variants of the above in charts | — |

### Accent alpha ramp

The accent appears at 15 opacities. They are not arbitrary — collapse to a scale:

`.06 .07 .09 .10 .12 .13 .14 .15 .16 .18 .20 .22 .25 .28 .32 .35 .40 .45 .50 .55`

| Ramp step | Used for |
|---|---|
| `.06–.09` | selected-card fill |
| `.10–.16` | icon tile behind an accent glyph; badge fill |
| `.18–.25` | gradient card border; button shadow |
| `.32–.55` | selected-card border; dashed accent border |

## Gradients

| Value | Where |
|---|---|
| `linear-gradient(160deg,#16221A,#141A16)` | readiness card (home) |
| `linear-gradient(160deg,#1D1512,#141416)` | week-score card (weekly) |
| `linear-gradient(150deg,#241710,#17181A)` | "Follow a Program" card (train) |
| `linear-gradient(135deg,#1C1408,…)` | Go Pro row (profile) |
| `radial-gradient(130% 90% at 50% -10%, rgba(233,113,47,.20), #101011 55%)` | screen atmosphere, "ember" |
| `radial-gradient(130% 90% at 50% -10%, rgba(121,185,138,.18), #101011 55%)` | screen atmosphere, "verdant" |
| `repeating-linear-gradient(135deg,#141517 0 10px,#17181A 10px 20px)` | image placeholder |

The atmosphere gradient is a prototype **tweak** (`atmosphere: midnight | ember | verdant`),
default `ember`. Ship one value. `ember` is the designed default.

## Typography

One family: **Archivo**, bundled at `assets/fonts/Archivo-Variable.ttf` (SIL OFL 1.1).
Weight moves through the `wght` axis — use `AppText.weighted`, never a bare
`copyWith(fontWeight:)`.

Weights in use: **400** body · **500** metadata and labels · **600** row titles, buttons,
segmented controls · **700** headlines, numerals · **800** wordmark only.

| Role | Spec | Flutter |
|---|---|---|
| Welcome headline | 700 · 34 / 1.14 · `-.03em` | `AppText.h1Welcome` |
| Auth headline | 700 · 27 / 1.15 · `-.02em` | `AppText.h1Auth` |
| Screen header | 700 · 26 / 1.15 · `-.02em` | `AppText.hdrTitle` |
| Profile name | 700 · 19 · `-.01em` | `AppText.nameTitle` |
| Hero numeral (readiness, timer) | 700 · 40–46 / 1 · `-.03em` · tabular | — *(add `heroNumeral`)* |
| Stat numeral | 700 · 25 / 1 · `-.02em` · tabular | — *(add `statNumeral`)* |
| Stat unit suffix | 500 · 11.5 | — |
| Card title | 700 · 15.5 / 1.2 | — |
| Row title | 600 · 14.5 / 1.25 | `AppText.rowTitle` |
| Row subtitle | 400 · 12 / 1.3 | `AppText.rowSubtitle` |
| Body / subhead | 400 · 13.5 / 1.4 | `AppText.body` |
| Insight body | 500 · 13 / 1.45–1.5 | — |
| Section label | 600 · 9.5 / 1 · `.14em` · uppercase | `AppText.label` |
| Metric label | 600 · 9 / 1 · `.10em` · uppercase | — |
| Button | 700 · 15.5 / 1 · `.01em` | `AppText.button` |
| Input | 500 · 14.5 | `AppText.input` |
| Link | 600 · 12.5 / 1 | `AppText.link` |
| Chip / segment | 600 · 12.5–13 / 1 | — |
| Tab label | 500 / 600 when active · 10 / 1 | `AppText.tabLabel` |
| Inline error | 500 · 12 / 1 | `AppText.inlineError` |
| Legal | 400 · 11.5 / 1.5 | `AppText.legal` |
| Wordmark | 800 · 21–23 / 1 · `.02em` | `AppText.wordmark` |
| Chart axis | 500 · 10 / 1 | — |

**Letter-spacing is in `em` in the design and logical pixels in Flutter.** Multiply by font
size and keep the arithmetic in a comment, as `app_typography.dart` already does.

**Every numeral uses `font-variant-numeric: tabular-nums`** so a ticking timer or a changing
weight does not shift its neighbours. In Flutter: `FontFeature.tabularFigures()`.

## Spacing

| Value | Where | Flutter |
|---|---|---|
| 22 | screen horizontal gutter | `AppDimens.screenPaddingX` |
| 26 | status-bar horizontal padding | — |
| 15–16 | card interior padding | — |
| 13–14 | list row vertical padding | `AppDimens.rowPaddingY` (15) |
| 12 | gap between stacked cards | — |
| 16 | gap between form fields | `AppDimens.fieldGap` |
| 8–10 | gap between chips | — |
| 22–26 | gap above a new section label | — |

## Radii

`1 · 1.5 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · 11 · 12 · 13 · 14 · 15 · 16 · 18 · 19 · 20 · 999`

| Value | Role | Flutter |
|---|---|---|
| 9 | chip, small tile | `AppDimens.chipRadius` |
| 10–11 | option row, field, icon tile | `AppDimens.fieldRadius` (11) |
| 12 | button, segmented track | `AppDimens.buttonRadius` |
| 13–14 | card | `AppDimens.cardRadius` (14) |
| 15–16 | hero card | — |
| 20 / 999 | pill badge | — |
| 44 / 54 | phone frame — mock chrome, do not ship | — |

## Sizes

| Value | Role | Flutter |
|---|---|---|
| 390 × 844 | design viewport (iPhone 14 Pro logical) | — |
| 52 | status bar height (mock) | — |
| 52 | button and field height | `AppDimens.controlHeight` |
| 76 | tab bar height | `AppDimens.tabBarHeight` |
| 12 | tab bar backdrop blur | `AppDimens.tabBarBlur` |
| 34 | back-chevron box (48 hit target) | `AppDimens.backButtonSize` |
| 52 | avatar | `AppDimens.avatarSize` |
| 22 / 18–19 | icon, icon small | `AppDimens.iconSize` / `iconSizeSmall` |
| 46 × 27 | toggle track, 21 knob | — |
| 200 | rest-timer ring, `r=86`, 8px stroke | — |
| 36–38 | icon tile in a hero row | — |

**Minimum tap target is 44.** Several glyph-only controls are drawn at 34 or smaller; pad the
hit box out rather than growing the glyph, exactly as `ForjdBackButton` already does.

## Shadows

| Value | Where |
|---|---|
| `0 6px 22px rgba(233,113,47,.22)` | primary button |
| `0 8px 26px rgba(233,113,47,.20)` | accent hero card |
| `0 10px 30px rgba(0,0,0,.50)` | toast |
| `0 1px 3px rgba(0,0,0,.40)` | selected segment |
| `0 6px 18px rgba(233,113,47,.25)` | floating "+" action |

## Icon set

Thin stroke on a 24 x 24 canvas, `stroke-width: 1.6`, round caps and joins, already
transcribed to `core/widgets/forjd_icons.dart` and stroked through `path_drawing`.

22 glyphs live in the prototype's icon map:

`home train progress rank profile · bolt heart · target link scale shield pin runner upload
dumb star search clock plus check x · chevron`

**`runner`** — head circle plus five stroked segments (leaning torso, two bent arms, a driving
front knee, a trailing heel) — is the newest glyph, drawn for Train's "Start a run" tile.
`pin` still means *place* everywhere else.

Two more — **`bell`** (home header) and **`chart`** (welcome feature row, live-workout card) —
are drawn inline in the template rather than through the map. They are part of the set; the
audit removed only their unused map entries.

Missing and needed: **`calendar`** (birthday field borrows `clock`), **`eye`** (password
visibility), **`pencil`** (edit). Those three are Material glyphs today, which is why
`uses-material-design: true` stays.


