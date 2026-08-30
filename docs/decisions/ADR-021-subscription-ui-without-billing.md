# ADR-021: Subscription screens ship as UI, with no billing behind them

**Status:** Accepted
**Date:** 2026-08-30
**Relates to:** Phase 10 (leaderboards + subscriptions), which still owns real billing

## Context

The revised design draws a complete subscription surface: a `Go Pro` paywall listing five
perks with Yearly (`$59.99`, `SAVE 40%`) and Monthly (`$9.99`) plans, a `Manage Subscription`
screen with a switch-plan row and a cancel row, a `Cancel Pro subscription?` confirmation
sheet, a `Pro User` badge on the profile identity row, and a `Pro plan - Yearly - renews
automatically` card on Edit Profile with a `Manage` button.

The backend has none of it. `PLANS` in `packages/domain` is a **one-member tuple**
(`['free']`), and `SubscriptionService` returns that literal unconditionally. The `plan` field
on `ProfileResponse` is decorative, a shape reserved for a decision not yet made.

Real billing is not a screen problem. It requires paid Apple and Google developer accounts,
store-side product configuration, a receipt-validation path, and in practice a vendor such as
RevenueCat to avoid writing two native purchase integrations by hand. The project's recorded
infrastructure constraint is free tiers only.

## Decision

**The subscription screens ship as UI. No in-app purchase, no payment, nothing charged, and
nothing actually gated.**

Concretely:

- `PLANS` gains a second member so `free` and `pro` are both representable and the profile's
  `plan` field stops being decorative.
- `plan` remains **server-derived and never client-writable**, exactly as it is today. A
  client cannot promote itself by patching its profile.
- The paywall, Manage Subscription and cancel sheet render fully and navigate correctly. The
  purchase action does not call a store.
- **No feature is withheld from a `free` account.** The perks list on the paywall describes
  what Pro will mean, not what free users currently lack. Gating a feature behind a plan the
  user has no way to buy would be a dead end presented as a choice.
- Real billing (store accounts, IAP, receipt validation, a vendor) stays **Phase 10**, and
  gets its own ADR when it is planned.

## Alternatives rejected

**Wire real billing now.** Needs paid store accounts and a billing vendor, both outside the
project's free-tier constraint, and it would be built long before there is anything worth
charging for. Phase 10 exists for this.

**Leave the screens out entirely.** They are drawn, and two *already-shipped* screens point
at them: `(tabs)/profile.tsx` has an inert "Go Pro" banner and `edit-profile.tsx` has an
inert plan card, both rendered per the design with deliberately no handler. Building the
destinations turns two dead controls into working ones for the cost of three static screens.

**Gate something real behind `pro` to make the flag meaningful.** Would make the app worse
for every current user, all of whom are `free` and none of whom can upgrade, in exchange for
exercising a code path that has no purchaser. The flag can be meaningful later without being
punitive now.

**Fake a purchase (a "simulate upgrade" affordance).** Creates an account state that real
billing would then have to reconcile, and invites a tester to believe they bought something.
If `plan` needs to be `pro` for development, that is a database-level or seed-level concern,
not a user-facing control.

## Consequences

- The paywall's `Continue` button is the one screen element in the app whose primary action
  deliberately does nothing conclusive. It needs honest interim copy or a disabled state; a
  button that silently no-ops is a bug report waiting to be filed.
- `(tabs)/profile.tsx`'s comment explaining that `plan` "stays the literal string 'Free User'
  because `PLANS` is a one-member tuple" becomes wrong once the tuple has two members, and
  must be updated alongside the change.
- Prices in the design (`$59.99` and `$9.99`) are **placeholders rendered from the
  prototype**, not a pricing decision. Nothing here commits the product to them, and Phase 10
  should treat them as unset.
- This ADR is explicitly reversible and expected to be superseded. It describes an interim
  state, and Phase 10's billing ADR replaces it rather than amending it.
