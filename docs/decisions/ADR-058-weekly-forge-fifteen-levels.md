# ADR-058: Weekly Forge — 15 levels, anchored to published sources

**Status:** Accepted (2026-09-27)
**Date:** 2026-09-27
**Amends:** ADR-057 decision 6 (tier values).
**Plan:** [weekly-forge-explainer-plan.md](../product/weekly-forge-explainer-plan.md)

## Context

ADR-057 built each ladder from hand-written Ore values, then 12% per level from Ember up. That gave
Volume and Distance 33 levels and Active minutes 25. On a real device the owner found it too much:

- A ladder screen listing 33 goals reads like a spreadsheet.
- Hitting every goal, reaching Forged takes more than 27 weeks.
- The top goals were 106,600 kg and 277 km a week, beyond almost everyone. Forged was decoration.

The owner also asked, as a standing rule, that training guidance be backed by published sources
they approve.

## Decision

1. **Volume, Distance and Active minutes have 3 levels in each band, 15 in total.** Consistency
   (6 levels) and Nourish (6 levels, ending at Anvil) are unchanged.

   | Ladder | Ore (L1–3) | Ember (L4–6) | Anvil (L7–9) | Tempered (L10–12) | Forged (L13–15) |
   |---|---|---|---|---|---|
   | Volume kg | 2,000 · 3,000 · 4,000 | 5,500 · 7,500 · 10,000 | 13,000 · 17,000 · 22,000 | 28,000 · 35,000 · 43,000 | 52,000 · 62,000 · 75,000 |
   | Distance km | 5 · 8 · 12 | 16 · 21 · 27 | 34 · 42 · 52 | 63 · 75 · 88 | 100 · 115 · 130 |
   | Minutes | 60 · 90 · 120 | 150 · 190 · 230 | 300 · 360 · 420 | 480 · 560 · 640 | 720 · 810 · 900 |

2. **Band starts are pinned to sources; the steps inside a band are even.**
   - **Minutes:** Ember starts at 150 and Anvil at 300, the bottom and top of the WHO weekly range
     (R1). Ore climbs to that floor. Tempered and Forged go past the range, up to 900 minutes
     (15 hours), and each workout still counts at most 2 hours (ADR-046).
   - **Distance:** Ember starts at 16 km, a steady few runs a week. Anvil (34–52 km) covers the
     low-volume marathon plans in R5 (average 43 km) and the 45 km average of 119,452 marathoners
     in R6. Tempered (63–88 km) reaches the middle and upper plans. Forged starts at 100 km, where
     R6 found the fastest marathoners and R5's high-volume plans average 108 km.
   - **Volume:** Ore and Ember follow R2's starting programme (8–10 exercises, 1–3 sets of 8–12
     reps, 2–3 days a week). Anvil matches about 10 hard sets per muscle a week, the level R3 found
     clearly better for muscle growth. Tempered and Forged go to 15–20+ sets per muscle, where R4
     found gains still rising but more slowly.
3. **Kilograms are an estimate.** No source publishes a normal weekly tonnage, because it depends
   on body size and exercise choice. The sources give sets, reps and sessions. The kilograms
   multiply those by an assumed average weight per rep: about 25 kg in Ore and Ember, 30–35 kg in
   Anvil, and 35–55 kg in Tempered and Forged. The owner accepted this on 2026-09-27. It's the
   first row to revisit once real users' volume data exists.
4. **Existing levels are recomputed, not mapped.** Every closed week's locked total is stored
   (ADR-057 decision 1), so the change replays each athlete's weeks in order through the new table
   and rewrites `forge_weeks` (level, band, target, outcome, streaks) and `forge_user_ladders`.
   `FORGE_RULES_VERSION` becomes 2 and marks the rewritten weeks.
   - **Totals never change.** ADR-057's promise that a closed week's input is locked still holds.
     Only the judgement of that input is redone, and redone deliberately, which is what
     `rules_version` exists to record.
   - **Rewards are kept.** The ledger stays append-only. The replay adds any reward the new table
     earns, using the existing `on conflict do nothing`, and removes none. A `forge_mark` for an old
     level above 15 stays in the ledger as history. Nothing in the app lists marks by level number.
   - The recompute runs on deploy, right after `forge:seed`, and only touches athletes with a week
     below the current `rules_version`, so running it again changes nothing.
   - This replaces ADR-057's "clamp to the new top" rule for this change. The clamp stays in the
     code for any future cut made without a recompute.

## Sources (approved by the owner, 2026-09-27)

- **R1.** Bull FC, et al. World Health Organization 2020 guidelines on physical activity and
  sedentary behaviour. *Br J Sports Med* 2020;54:1451–1462. https://pubmed.ncbi.nlm.nih.gov/33239350/
- **R2.** American College of Sports Medicine. Position stand: Progression models in resistance
  training for healthy adults. *Med Sci Sports Exerc* 2009;41(3):687–708.
- **R3.** Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance
  training volume and increases in muscle mass: a systematic review and meta-analysis.
  *J Sports Sci* 2017;35(11):1073–1082. https://pubmed.ncbi.nlm.nih.gov/27433992/
- **R4.** The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly
  Volume and Frequency on Muscle Hypertrophy and Strength Gains. 2025.
  https://pubmed.ncbi.nlm.nih.gov/41343037/
- **R5.** Knopp M, Appelhans D, Schönfelder M, Seiler S, Wackerhage H. Quantitative Analysis of 92
  12-Week Sub-elite Marathon Training Plans. *Sports Med Open* 2024.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11065819/
- **R6.** The Training Intensity Distribution of Marathon Runners Across Performance Levels.
  *Sports Med* 2024 (119,452 runners, 151,813 marathons). https://pubmed.ncbi.nlm.nih.gov/39616560/

## Consequences

- Someone hitting every goal reaches Forged in about 13 weeks instead of more than 27.
- Each step inside a band is bigger (roughly 25–50% in Ore, 15–30% higher up), so a single level
  means more. The +3 cap on one week's climb covers a whole band.
- `forge_tiers` loses levels 16–33. `forge:seed` already prunes removed levels.
- No schema migration and no API contract change: only the numbers inside responses change.
- The ladder screen and the FAQ can now show every goal on one short list.
