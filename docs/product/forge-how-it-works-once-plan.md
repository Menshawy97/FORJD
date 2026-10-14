# Weekly Forge "How it works" opens once

**Status:** Approved 2026-10-15 (owner, onboarding question: only part C of the mock-up, built
before the Android beta). One PR.

## What the owner decided (2026-10-15)

The onboarding mock-up offered three parts: A, a Units step at the end of sign-up; B, a
"Get started" checklist on Home; C, the Weekly Forge explainer opening by itself once. The owner
chose **C only**. A and B are not planned. Permissions stay as they are: each one is asked when it is
first needed (location at the first run, notifications at the first reminder switch, health data in
Privacy), not during sign-up.

## Behaviour

1. The first time Home shows the Weekly Forge card for a signed-in person, the How it works screen
   (`app/forge/how-it-works.tsx`) opens on top of Home. The screen itself is unchanged; its back
   arrow returns to Home.
2. It never opens by itself again for that person on that phone.
3. Opening How it works from the card's info icon also counts, so someone who read it already is
   not shown it again.
4. Nothing opens while the feature flag is off (the card is not shown, so it was not "seen").
5. The "already shown" note is an account preference (`store/account-preferences.ts`): forgotten at
   sign-out, so a second account on the same phone gets its own first look. A person who signs out
   and back in sees it once more; that is accepted (rare, and harmless).
6. If the note cannot be read, nothing opens (fail closed: an explainer popping up every visit is
   worse than one missed). If it cannot be written, the screen still opens, and may open once more
   on a later visit.

## Bug checklist

- Two focus events in a row (Home refocused before the write lands) must not open two copies: the
  note is written before the screen is pushed, and an in-flight guard covers the read.
- The open happens on Home's focus, not on mount, so returning from How it works does not reopen it
  (the note is already written).
- Off-flag accounts never write the note.

## Files

- `apps/mobile/src/store/forge-how-it-works-shown.ts` (new): `hasSeenForgeHowItWorks`,
  `markForgeHowItWorksSeen`, key `forjd.forgeHowItWorksShown.v1`, added to
  `ACCOUNT_PREFERENCE_KEYS`.
- `apps/mobile/src/features/forge/weekly-forge-section.tsx`: opens the screen once when visible.
- `apps/mobile/src/app/forge/how-it-works.tsx`: marks the note when opened.
- Tests: the store, the section (opens once, not when off, not when already seen, not on a failed
  read, one open for two focuses) and the screen (marks on open).

## Owed

- Device check with the beta: a fresh account sees How it works once on its first Home visit.
