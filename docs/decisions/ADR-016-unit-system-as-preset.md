# ADR-016: `unitSystem` is a preset, not a preference

**Status:** Accepted
**Date:** 2026-08
**Amends:** the implied model behind `profiles.unit_system` (introduced in slice 11, never
given an ADR of its own)

## Context

`profiles.unit_system` has existed since the first schema, carrying `metric | imperial`, with
the comment "Display preference only. Everything is stored in metric; conversion happens at
the edge." The implied model was that one flag determines how every quantity is displayed.

The `units` screen in the design contradicts that model. It draws **four** controls, not one:
a Measurement system row (Metric / Imperial) and three independent rows for Weight (kg/lb),
Distance (km/mi) and Energy (kcal/kJ). The prototype's own handler makes the relationship
explicit — picking a system writes weight and distance together, and touching a single unit
writes only itself:

```js
setSystem: {system: sys, weight: sys==='Metric'?'kg':'lb', distance: sys==='Metric'?'km':'mi'}
```

Energy is not in that object. The prototype will also happily show `lb` selected while the
system row still reads `Metric` — an internally inconsistent state it makes no attempt to
prevent.

Two facts make the single-flag model unrecoverable rather than merely awkward:

1. **`kg` with `mi` belongs to no system.** The combination is perfectly reasonable for a
   user, and there is no value of `unitSystem` that describes it.
2. **Energy has no system at all.** `kJ` is not "the imperial one" — it is the norm in
   markets that are otherwise fully metric, and the United States, the most imperial market
   there is, uses `kcal`. Any mapping from `unitSystem` to an energy unit would be invented.

So the three units cannot be derived from the flag, and the flag cannot be derived from the
three units. Neither direction is lossless.

## Decision

**The three unit fields are the real preferences. `unitSystem` is demoted to a preset** — a
convenience that writes two of them.

`weightUnit`, `distanceUnit` and `energyUnit` become NOT NULL columns on `profiles`
(defaulting `kg`/`km`/`kcal`) and fields on `profileResponseSchema` /
`updateProfileRequestSchema`.

`unitSystem` is **kept** and marked `@deprecated`, with three server-side rules in
`UsersService`:

1. A preset expands into weight and distance — **and never energy**.
2. An explicit unit in the same request **wins** over a preset that contradicts it. Rejecting
   the combination instead would fail a request whose intent is perfectly clear
   ("imperial, but weigh me in kg").
3. Explicit units **never back-derive** the preset. There is no honest value to write, so
   `unitSystem` only ever holds what someone actually sent.

Rule 3 is the asymmetric one, and it is the point: the field is allowed to become stale
rather than to become a fiction.

`unitSystem` is removed in `/api/v2`.

## Alternatives rejected

**Remove `unitSystem` now.** It is a shipped field on `/api/v1`, and CLAUDE.md rule 7 forbids
breaking changes to a shipped version. This is the whole reason for the deprecation window.

**Derive `unitSystem` on read** (compute it from the three units). Lossy, per the Context
above: `kg`+`mi` has no correct answer and `kJ` has none under either system. The endpoint
would have to invent a value and report a preset the user never chose.

**Reject contradictory combinations** (400 on `unitSystem: imperial` + `weightUnit: kg`).
Rejects a request with clear intent, and makes the client responsible for pre-resolving a
precedence the server can resolve unambiguously.

**Store the units device-locally instead.** They would not survive a reinstall or a second
device, and — unlike the notification toggles, which are genuinely device-scoped — a unit
preference is an attribute of the person, not of the handset.

## Consequences

- A client can read a `unitSystem` that disagrees with the units beside it. That is correct
  and expected; the units are authoritative and the flag is a historical convenience. The
  pinned fixture `profile-response.json` deliberately encodes exactly this case
  (`unitSystem: metric` with `weightUnit: lb`, `energyUnit: kJ`) so a client that reads the
  deprecated field instead of the real ones fails visibly rather than silently.
- The `units` screen can round-trip every state the prototype allows, including the
  internally inconsistent ones — the design is implementable exactly rather than approximately.
- `/api/v2` gets a smaller, honest shape: three fields, no preset.

## Note on numbering

`docs/product/roadmap.md` had reserved **ADR-015** for the Supabase topology decision and
`docs/product/slice-2-plan.md` had reserved the same number for this one. This ADR takes
**016** and leaves 015 to the topology decision, which was reserved first.
