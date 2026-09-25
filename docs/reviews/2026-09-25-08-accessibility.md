# Lane 8 — Accessibility and UI (2026-09-25, at b1f006a)

### L8-1 — Rank tab's selected chip fails text contrast (regression of the fixed H13 pattern)
- **Severity:** high · **Where:** `apps/mobile/src/features/rank/rank-chip.tsx:26-35`; `app/(tabs)/rank.tsx:26`
- **Scenario:** the selected metric chip draws white 12.5px text on `bg-accent` (#E9712F), measured 3.06:1 in `theme/__tests__/tokens.test.ts:119`, under the 4.5:1 AA minimum. Every other CTA moved to `accentDark` under H13/R19; the Rank chip was added later with the old fill.
- **Suggested fix:** `bg-accentDark` / `colors.accentDark`.

### L8-2 — `SegmentedControl` default size is a 38px touch target
- **Severity:** medium · **Where:** `apps/mobile/src/components/segmented-control.tsx:41,70-97`; used by `rank.tsx:123-128`
- **Suggested fix:** height 44, or `hitSlop` of 3 top/bottom.

### L8-3 — Nutrition share's photo button is 34×34 with no `hitSlop`
- **Severity:** medium · **Where:** `apps/mobile/src/app/nutrition-share.tsx:322-329`
- **Suggested fix:** `hitSlop` 6 all round, or 44×44.

### L8-4 — `lineHeight` equal to `fontSize` with no `maxFontSizeMultiplier` anywhere: clipped text at large font sizes
- **Severity:** medium · **Where:** 19 sites in 7 files, e.g. `app/(tabs)/rank.tsx:38-46`, `features/rank/rank-card.tsx:56-104`, `features/rank/rank-row.tsx:48-119`, `rank-chip.tsx:31-32`
- **Suggested fix:** `lineHeight` as a multiple of `fontSize`, or `maxFontSizeMultiplier` on tight numeric displays.

## Unconfirmed (not findings)
- `colors.label` (#94948B) and `colors.dimmer` (#8A8A82) were measured under 4.5:1 in the 2026-09-12 audit and still appear on new screens; confirm this is tracked, not assumed closed.
- Small chip/segment text at `colors.dim` / `segmentedInactive` contrast not computed.

## Checked and clean
H12 live-region fixes hold (rest, set-timer, countdown ring, toast, the "Not saving" warning); Goals / Activity level / Body goal roles, labels, states, `accentDark` buttons; InBody manual and confirm labels, confidence never colour-only, `accentDark`; FAQ rows (`expanded` state); run and run-done icon buttons labelled and ≥ 44; nutrition share sheet has no text input (keyboard rule n/a), other buttons ≥ 44.
