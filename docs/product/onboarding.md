# Onboarding: notes for the onboarding work

**Status:** Briefed 2026-10-15. The owner chose one part, Weekly Forge "How it works" opening by
itself once, built before the Android beta: [forge-how-it-works-once-plan.md](forge-how-it-works-once-plan.md).

## Decisions (2026-10-15)

The mock-up offered three parts:

- **A. A Units step** at the end of sign-up (kg/lb, km/mi, kcal/kJ, pre-chosen from the phone's
  region). Not chosen. Units stay in Profile.
- **B. A "Get started" card** at the top of Home for new accounts (first workout, a run, Health
  Connect, an InBody scan). Not chosen.
- **C. Weekly Forge "How it works" once.** Chosen; see the plan.

Permissions are not asked during sign-up. Each is asked when it is first needed, as before.

Sign-up today: Welcome, Sign up (and the email check), Your Profile (username and date of birth),
What are you training for?, How active are you?, What's your goal?, then Home.

## Notes

### Weekly Forge "How it works" (2026-09-27)

Weekly Forge has a How it works screen (`app/forge/how-it-works.tsx`, see
[weekly-forge-explainer-plan.md](weekly-forge-explainer-plan.md) D4). Until 2026-10-15 it only
opened from the info icon on the Home card's Weekly Forge heading; the owner had decided not to
open it automatically until onboarding was planned. Since the 2026-10-15 brief it also opens by
itself once, the first time Home shows the card with a week.
