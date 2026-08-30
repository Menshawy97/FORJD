# Slice 2 — Screen Specifications (extracted from the prototype)

> ## ⚠ STALE LINE NUMBERS + two decisions overturned — 2026-08-30
>
> **Every prototype line number in this file is wrong.** `FORJD Mobile.dc.html` was
> regenerated and grew by ~1,400 lines. Re-anchor with
> `grep -nE "^\s*s_[A-Za-z0-9_]+\s*\(" "FORJD mobile app design/FORJD Mobile.dc.html"`.
> The copy and geometry transcribed here were not invalidated — only the citations.
>
> **Two of this document's decisions are overturned** by
> [ADR-019](../decisions/ADR-019-username-and-avatar.md):
>
> - The decisions box's **"drop the handle concept entirely"** — the revision adds a
>   `pickUsername` onboarding screen, a Username field on `editProfile`, and `@handle` on the
>   public profile. Username is a real column now.
> - **Avatar has no control** — the revision adds upload affordances in two places.
>
> **Not overturned:** the athlete stat tiles stay omitted (the Phase 10 data still does not
> exist), and the generic-404 error state stays generic (the backend deliberately makes
> "private" and "no such user" indistinguishable, and reproducing the prototype's
> stranger-specific copy would leak exactly that).
>
> `editProfile` and `athlete` both gain content in the revision; specs for the new parts are
> in [`design-revision-screen-specs.md`](design-revision-screen-specs.md). Delta record:
> [`design-revision-2026-08-30.md`](design-revision-2026-08-30.md).

> ## Decisions since extraction — read before §8, §10 and §11
>
> This document was written during planning. Several of the questions it raises have since
> been answered, so **the sections below are partly superseded**. Where this box and the
> body disagree, this box wins.
>
> | Question in the body | Resolution |
> |---|---|
> | §8 / §11 Q1 — the `sex` enum mismatch | **Resolved.** `sexSchema` was narrowed to `male\|female\|prefer_not_to_say` to match the prototype's three chips. `other` is gone from both `@forjd/contracts` and `@forjd/domain`. §8 describes a problem that no longer exists. |
> | §11 Q2 — is there push in Phase 1? | **No.** `notifs` is device-local only. |
> | §11 Q3 — are Weight/Distance/Energy independent? | **Yes, three real preferences.** `unitSystem` is retained but redefined as a *preset*, marked `@deprecated`, removed in `/api/v2`. |
> | §11 Q4 — public profile / `athlete` screen | **Being built.** `GET /api/v1/athletes/:userId`, authenticated-only, refusal is 404 (never 403). Ships **identity only** — the stat tiles need Phase 10 leaderboard/analytics data and are omitted. |
> | §11 Q7 — toggle tap targets | **Whole row is tappable**, deviating from the prototype. `05-interactions.md` requires a 44px minimum; this changes behaviour, not appearance. |
> | §12 — the `@jmitch` handle | ~~**Dropped.** No `handle` column, no username concept. That line shows city alone.~~ **OVERTURNED 2026-08-30 — [ADR-019](../decisions/ADR-019-username-and-avatar.md).** `username` becomes a real, case-insensitively unique column, and the handle returns to `profile`, `editProfile` and `athlete`. |
> | §2.9 — the `editProfile` Plan row | Hardcoded `Free plan` / `Go Pro`, non-navigating. Billing is Phase 10. **Amended 2026-08-30 — [ADR-021](../decisions/ADR-021-subscription-ui-without-billing.md):** the row gains a Pro variant and a working `Manage` destination. Still no billing — UI only, nothing gated or charged. |
>
> Still genuinely open: §11 Q5 (data export), §11 Q6 (British vs US spelling), and whether
> `city` should be public whenever the profile is public or need its own flag.
>
> This document is slice 2's **design reference**, not its scope. The build order, backend
> design and verification steps live in the approved slice 2 plan.

**Source of truth:** `FORJD mobile app design/FORJD Mobile.dc.html` (300,925 bytes).
Every value below was read out of that file. Where `design_handoff_forjd_mobile/01-screen-inventory.md`
or `05-interactions.md` disagree, the prototype value is used and the disagreement is flagged
in **§9 Doc-vs-prototype discrepancies**.

Backend contract checked: `packages/contracts/src/index.ts` (141 lines).

---

## 0. Summary — build readiness

| Screen | Chrome | Data classification | Build readiness |
|---|---|---|---|
| `editProfile` | `hdr("Edit Profile")` → profile, **no tab bar** | Name → A, Birthday → A, Sex → A (enum mismatch), Plan row → **B** | **Partial** — form is buildable today; the Plan row is entirely unbacked |
| `units` | `hdr("Units & Preferences")` → profile, **no tab bar** | System → A (`unitSystem`); Weight/Distance/Energy → **B** (or C if scoped device-local) | **Partial** — 1 of 4 controls backed |
| `goals` | bare chevron, no title, **no tab bar** | Goals[] and Activities[] → **B** (nothing in the contract) | **Blocked on backend** |
| `notifs` | `hdr("Notifications")` → profile, tab bar (Profile) | 5 toggles → **C** (device-local) if local-only notifications; **B** if server-pushed. Quiet hours → C/B | **Buildable now as device-local**; blocked if push is server-side |
| `privacy` | `hdr("Privacy Settings")` → profile, tab bar (Profile) | 5 consent toggles → **B** (must be server-enforced); diagnostics → C; 3 permission rows → B/C | **Blocked on backend** for the consent flags |
| `location` | bare chevron → `←locationReturnTo`, tab bar follows origin | Nothing persisted except the implied city → **B** | **Partial** — screen renders now; "Allow" has no field to write to |

Recommended build order and open questions are at the end (§10, §11).

---

## 1. Shared primitives (verified against the prototype)

### Constants (line ~95305 of the HTML)

```js
const O='#e9712f', GRN='#79b98a', W='#f6f5f3', DIM='#9a9a92',
      DIMMER='#6e6e66', CARD='#17181a',
      BRD='1px solid rgba(255,255,255,.07)';
```

Confirmed exactly as briefed, **plus one not in the brief**: `CARD = #17181a`.
Screen ground is `#101011` (from `.fj-screen.fj-atm-ember` radial gradient, which falls to
`#101011` at 55%, and from the `goals` CTA bar background).
Typeface: `Archivo` on every single `font:` shorthand in these six screens.

Other constants confirmed present in the source: field bg `#151517`, error border `#b8422f`,
placeholder `#5d5d57`, tab inactive `#6b6b64`, destructive `#c9503c`.
`#e05a3c` (error text) is **not used by any of these six screens** — it lives on `signup`.

### `hdr(title, onBack, right)`

```
container: flex:none; padding: onBack ? '2px 22px 14px' : '2px 22px 12px'
back chevron (only when onBack):
  34×34 box, margin '0 0 10px -8px', border-radius 10, cursor pointer
  hover: background rgba(255,255,255,.06)
  svg 20×20, viewBox 0 0 20 20, path 'M12.5 4 6.5 10l6 6'
  stroke #f6f5f3, stroke-width 1.7, linecap/linejoin round
title row: flex, align center, space-between
  h1: margin 0; font 700 26px/1.15 Archivo; letter-spacing -.02em; color #f6f5f3; white-space nowrap
  right slot: optional (unused on all six screens)
```

### `scroll(children, pad)`

`flex:1; min-height:0; overflow-y:auto; scrollbar-width:none; padding: pad || '0 22px 26px'`.
All six screens use the default padding.

### `lbl(text, extra)`

`font: 600 9.5px/1 Archivo; letter-spacing .14em; text-transform uppercase; color #77776f`
(note: `#77776f`, a seventh grey not in the brief's constant list).

### `btn(text, onClick, kind)`

```
base: height 52; border-radius 12; flex centered; cursor pointer
      font 700 15.5px/1 Archivo; letter-spacing .01em
      transition 'transform .12s, filter .12s'
primary: background #e9712f; color #fff; box-shadow 0 6px 22px rgba(233,113,47,.22)
         hover  filter: brightness(1.07)
         active transform: scale(.985)
ghost:   background transparent; border 1px solid rgba(255,255,255,.07); color #9a9a92;
         font-weight 600 (overrides the 700)
         hover background rgba(255,255,255,.04); color #f6f5f3
         (ghost has NO active/pressed rule)
```

### `field(label, value, ph, extra)`

Defined and available, but **none of these six screens call `field()`.**
`editProfile` uses raw `<input>` with its own `inputStyle` (see §2). Recorded for completeness:

```
column, gap 7
lbl(label)
box: height 52; border-radius 11; background #151517;
     border  extra.err ? '1px solid #b8422f' : BRD
     padding '0 15px'; gap 10
value span: font 500 14.5px/1 Archivo; color = value ? #f6f5f3 : #5d5d57
optional eye svg 19×19, stroke #9a9a92 sw 1.4
```

### `chips(items, active, onPick, extra)`

```
container: flex; gap 8; flex-wrap wrap
chip: padding '8px 15px'; border-radius 9; cursor pointer
      font 600 12.5px/1 Archivo
      selected:   background #e9712f; border '1px solid #e9712f'; color #fff
      unselected: background #191a1c; border BRD; color #9a9a92
      transition 'background .15s'
```
No pressed/disabled state. `chipStyle(on)` is the identical style object minus the transition.

### `row(icon, title, sub, onClick, right)`

```
flex; align center; gap 14; padding '15px 2px'; cursor onClick ? pointer : default
border-bottom 1px solid rgba(255,255,255,.05)
hover (only when onClick): background rgba(255,255,255,.025)
icon slot (if icon): width 22, flex:none, icon(name,'#8b8b83',22)
title: font 600 14.5px/1.25 Archivo; color #f6f5f3
sub:   margin-top 3; font 400 12px/1.3 Archivo; color #6e6e66
right: the passed node, or (if `right` is undefined) a chevron
       wrapper opacity .5, icon('chevron','#8b8b83',18)
```

### `toggle(on, onClick)`

```
track: 46 × 27; border-radius 14; padding 3; flex:none
       background  on ? #e9712f : #2a2a2e
       transition 'background .18s'
knob:  21 × 21; border-radius 11; background #fff
       transform on ? translateX(19px) : none
       transition 'transform .18s'
```
No pressed or disabled state.

### `card(children, extra)`

`background #17181a; border 1px solid rgba(255,255,255,.07); border-radius 14` + `extra`.

### `icon(name, color, size)`

`<svg width=size height=size viewBox="0 0 24 24">`, default size 22, default stroke `#9a9a92`,
`stroke-width 1.6`, `fill none`, `linecap/linejoin round`.
Full glyph map: `home train progress rank profile bolt heart pin link scale shield target
upload plus search dumb star chevron check clock x pencil`.

### `tabbar(active)`

```
height 76; flex:none; border-top 1px solid rgba(255,255,255,.07)
background rgba(14,14,15,.96); backdrop-filter blur(12px); padding '10px 6px 0'
items: home/Home, train/Train, progress/Progress, rank/Rank, profile/Profile
each: flex:1 column, align center, gap 5
  icon(id, active ? #e9712f : #6b6b64, 22)
  label font (active?600:500) 10px/1 Archivo, same colour
```

### `flash(message)` — toast

```
position absolute; left 22; right 22; bottom 96
padding '13px 16px'; border-radius 12
background rgba(28,29,32,.97); border 1px solid rgba(255,255,255,.1)
box-shadow 0 10px 30px rgba(0,0,0,.5)
font 600 13px/1 Archivo; color #f6f5f3; animation fj-fade .2s
auto-dismiss after 1900ms; no action, no dismiss control
```

### `segStyle(on)` — present but **NOT used by `units`**

`flex:1; height 38; radius 9; font 600 13px/1 Archivo; background on?'#232326':'transparent';
color on?#f6f5f3:'#7e7e77'; box-shadow on?'0 1px 3px rgba(0,0,0,.4)':'none'`.
`units` rolls its own two-up control instead — see §3.

---

## 2. `editProfile`

### 2.1 Chrome
- `hdr('Edit Profile', this.go('profile'))` — 26px title, back chevron → `profile`.
- **No tab bar.** Root is `hdr` + `scroll` only.
- Root: `flex:1; min-height:0; column`. (No `animation:'fj-fade .3s'` on this screen's own
  root — the fade comes from the outer screen wrapper, `fj-fade .28s`.)

### 2.2 Exact copy
| String |
|---|
| `Edit Profile` |
| `Name` |
| `Birthday` |
| `Sex` |
| `Male` / `Female` / `Rather not say` |
| `Plan` |
| `Pro plan` (isPro) / `Free plan` (free) |
| `Yearly · renews automatically` (isPro, **middot U+00B7 with spaces**) |
| `Upgrade for unlimited access` (free) |
| `Manage` (isPro) / `Go Pro` (free) |
| `Save Changes` |
| toast: `Profile updated` |

Seed values: name `James Mitchell`, birthday `1998-04-12`, sex `Male`.

### 2.3 Layout order (top → bottom, inside `scroll`, padding `0 22px 26px`)
1. `lbl('Name', {marginBottom:9})`
2. `<input>` — `inputStyle`
3. `lbl('Birthday', {margin:'18px 0 9px'})`
4. `<input type="date">` — `inputStyle` + `colorScheme:'dark'`
5. `lbl('Sex', {margin:'18px 0 9px'})`
6. `chips(['Male','Female','Rather not say'], p.sex, …)` — gap 8, wrap
7. `lbl('Plan', {margin:'18px 0 9px'})`
8. Plan row (see 2.6)
9. `<div style="margin-top:26">` → `btn('Save Changes')`

### 2.4 Typography
- Labels: `600 9.5/1`, `.14em`, uppercase, `#77776f`
- Inputs: `600 14.5px Archivo` (no line-height token), colour `#f6f5f3`
- Chips: `600 12.5px/1`
- Plan title: `700 14.5px/1` `#f6f5f3`; Plan sub: `400 12px/1.3` `#6e6e66`
- Plan pill: `700 12px/1`
- Button: `700 15.5px/1`, `.01em`

### 2.5 Input sizing / colours (`inputStyle`)
```
width 100%; height 50; border-radius 11
background #151517; border 1px solid rgba(255,255,255,.07)
padding '0 15px'; font '600 14.5px Archivo'; color #f6f5f3; outline none
```
**Note the height is 50, not the 52 used by `field()` and `btn()`.** That is the prototype's
value, not a typo I introduced — `editProfile` defines its own `inputStyle` locally.
There is no error state, no placeholder, and no disabled state on either input.

### 2.6 Plan row states
```
common: padding '14px 16px'; border-radius 13; cursor pointer
        flex, align center, space-between, gap 10
FREE (isPro=false):
  background #17181a; border 1px solid rgba(255,255,255,.07)
  title 'Free plan'; sub 'Upgrade for unlimited access'
  pill: 'Go Pro' — color #fff; background #e9712f; border none;
        border-radius 9; padding '8px 13px'; flex:none
  tap → setState({screen:'pro', proReturnTo:'editProfile'})
PRO (isPro=true):
  background rgba(233,113,47,.1); border 1px solid rgba(233,113,47,.5)
  title 'Pro plan'; sub 'Yearly · renews automatically'
  pill: 'Manage' — color #e9712f; background rgba(233,113,47,.15);
        border 1px solid rgba(233,113,47,.4)
  tap → go('managePlan')
```
No hover/pressed rule is declared on this row.

### 2.7 Save behaviour
`btn('Save Changes')` → `flash('Profile updated')` then `setState({screen:'profile'})`.
Always enabled; no validation; no error path.

### 2.8 Icons
**None.** No `icon()` call anywhere in `s_editProfile`. The back chevron is an inline SVG
inside `hdr`. (The handoff's claim about borrowing the `clock` glyph for the date field
describes the shipped Flutter screen, not the prototype — see §9.)

### 2.9 Data backing
| Element | Class | Detail |
|---|---|---|
| Name | **A** | `displayName` (`z.string().min(1).max(80).nullable()`) |
| Birthday | **A** | `dateOfBirth` — contract requires `YYYY-MM-DD` and a real calendar date; `<input type="date">` already emits that format |
| Sex | **A, with an enum mismatch** | `sex` — see §8 |
| Plan / isPro / `proPlan` ('yearly') | **B** | Nothing subscription-related exists in the contract. Needs a `subscription` object on `/me` (at minimum `tier: 'free'|'pro'`, `term: 'monthly'|'yearly'`, `renewsAt`) plus billing endpoints. Until then the row must be hard-coded to `Free plan` or hidden. |
| `profile.handle` / `profile.city` | **B** | Held in prototype state, not rendered on this screen, but rendered on `profile`. No `handle` or `city` field exists in the contract. |
| `heightCm` | — | The contract has it; **no screen in this set edits it.** Nowhere to put it yet. |
| `avatarUrl` | — | Contract has it; `editProfile` has no avatar control at all. |

---

## 3. `units`

### 3.1 Chrome
- `hdr('Units & Preferences', this.go('profile'))` → `profile`.
- **No tab bar.**
- Root carries `animation:'fj-fade .3s'` (one of only two of these six screens that does).

### 3.2 Exact copy
`Units & Preferences` · `Measurement system` · `Metric` `Imperial` · `Weight` · `kg` `lb` ·
`Distance` · `km` `mi` · `Energy` · `kcal` `kJ` · `Save Changes` · toast `Preferences updated`.

Note the ampersand in the title is a literal `&`, and `kJ` is lower-k / capital-J.

### 3.3 Layout order
Inside `scroll` (`0 22px 26px`), four identical `group()` blocks then the CTA:

```
group(label, options, key, onPick):
  lbl(label, {margin:'18px 0 9px'})
  row: display flex; gap 8
  option: flex 1; text-align center; padding '11px 0'; border-radius 10; cursor pointer
```
Order: Measurement system → Weight → Distance → Energy → `<div marginTop:26>` `btn('Save Changes')`.

**Every** label, including the first, uses `margin:'18px 0 9px'`, so there is 18px between the
header block and the first label.

### 3.4 Option states (this is a bespoke control, not `segStyle`)
```
font 600 13px/1 Archivo
selected:   background #e9712f; color #fff; border 'none'
unselected: background #17181a (CARD); color #f6f5f3; border 1px solid rgba(255,255,255,.07)
```
Note the **unselected label is full-brightness `#f6f5f3`**, not a dim grey — different from
`chips()`, which dims to `#9a9a92`. Height is implicit: `11px 0` padding over a 13px/1 line
= 35px. No hover, pressed, error or disabled state.

### 3.5 Coupling behaviour
`Measurement system` uses `setSystem`, which writes three keys at once:
```js
{system: sys, weight: sys==='Metric'?'kg':'lb', distance: sys==='Metric'?'km':'mi'}
```
Energy is **not** touched by the system switch. Weight/Distance/Energy each write only their
own key — and picking `lb` while system is `Metric` leaves the system chip on `Metric`, so
the screen can show an internally inconsistent state. That is the prototype's actual behaviour.

Defaults: `{system:'Metric', weight:'kg', distance:'km', energy:'kcal'}`.

### 3.6 Save behaviour
`flash('Preferences updated')` then `this.go('profile')()` — toast first, navigate immediately.

### 3.7 Icons
None.

### 3.8 Data backing
| Element | Class | Detail |
|---|---|---|
| Measurement system (Metric/Imperial) | **A** | `unitSystem: 'metric'\|'imperial'`. Design labels are Title Case, contract values lower-case — a presentation mapping, not a schema conflict. |
| Weight (kg/lb) | **B** or **C** | Not in the contract. Either add `weightUnit` to the profile, or scope it device-local. As drawn it is a *derived* value of `unitSystem` except when overridden — see 3.5. |
| Distance (km/mi) | **B** or **C** | Same as weight. |
| Energy (kcal/kJ) | **B** or **C** | Same, and it is **not** derived from `unitSystem` at all, so it cannot be faked from the existing field. |

The cheapest honest build: keep only *Measurement system* wired to `unitSystem`, and treat
the other three as read-only reflections of it (kg/km for metric, lb/mi for imperial) until a
`unitPreferences` object exists. That changes behaviour from the prototype and needs sign-off.

---

## 4. `goals`

### 4.1 Chrome
- **No `hdr`.** A bare back chevron in its own bar:
  `flex:none; padding '14px 22px 0'`, then a 34×34 hit box, `margin '0 0 0 -8px'`,
  `border-radius 10`, hover `background rgba(255,255,255,.06)`; svg 20×20,
  path `M12.5 4 6.5 10l6 6`, stroke `#f6f5f3`, sw 1.7.
- **No tab bar.**
- Back chevron destination (this is the trap):
  `setState({screen: goalsReturnTo==='newAccount' ? 'signup' : goalsReturnTo, goalsReturnTo:'profile'})`
  — i.e. **back from the first-run path returns to `signup`, not `home`**, and the key is
  always reset to `'profile'` on the way out.

### 4.2 Exact copy
| String |
|---|
| `What are you training for?` |
| `Pick everything that applies. This shapes your programs, insights and leaderboards.` |
| `Goals` |
| `Get stronger` · `Lose fat` · `Build muscle` · `Improve endurance` · `Feel better` |
| `Activities` |
| `Strength` · `Running` · `HYROX` · `Pilates` · `Cycling` · `Swimming` |
| `Save` |
| toast (new account): `Welcome to FORJD!` |
| toast (returning): `Goals updated` |

`HYROX` is all-caps. The subtitle uses "programs" (US spelling, no Oxford comma).

### 4.3 Layout order
```
back bar (flex:none, padding '14px 22px 0')
scroll (padding '0 22px 26px'):
  h1  margin '18px 0 0'; font 700 26px/1.15; letter-spacing -.02em
  p   margin '10px 0 22px'; font 400 13.5px/1.45; color #9a9a92
  lbl('Goals', {marginBottom:10})
  goals list: flex column; gap 8            (5 rows, full width)
  lbl('Activities', {margin:'22px 0 10px'})
  activities grid: grid-template-columns '1fr 1fr'; gap 8   (6 cells)
CTA bar (flex:none):
  padding '12px 22px 24px'
  border-top 1px solid rgba(255,255,255,.06)   ← .06, not the standard .07 BRD
  background #101011
  opacity wrapper, then btn('Save')
```

### 4.4 Option row states (`pick()`) — the multi-select
```
common: padding '13px 15px'; border-radius 11; cursor pointer
        flex, align center, space-between, gap 10
        transition 'background .15s'
UNSELECTED:
  background #17181a
  border 1px solid rgba(255,255,255,.07)
  label  font 600 14px/1 Archivo; color #b4b4ac      ← a dedicated grey, not DIM
  check  20×20; border-radius 10; border 1.5px solid #37383c;
         background transparent; empty
SELECTED:
  background rgba(233,113,47,.1)
  border 1px solid rgba(233,113,47,.45)
  label  font 600 14px/1 Archivo; color #f6f5f3
  check  20×20; border-radius 10; border none; background #e9712f
         svg 12×12 viewBox 0 0 24 24, path 'm5.6 12.4 4 4 8.8-9'
         stroke #fff, stroke-width 2.6, linecap/linejoin round
```
No hover, pressed or disabled state on the rows. Toggle handler is `toggleIn(key, value)` —
plain array add/remove; both lists allow zero or all selections.

### 4.5 The "disabled" Save button
```js
const ready = this.state.goals.length && this.state.acts.length;
```
The wrapper `<div>` gets `opacity: ready ? 1 : .4` and `pointerEvents: ready ? 'auto' : 'none'`.
The button itself is **unchanged** — same `#e9712f` fill and shadow, just 40% opacity and inert.
This is the only screen of the six with anything resembling a disabled state, and it
contradicts `05-interactions.md`'s "disabled does not exist in this design" (§9).

### 4.6 Save behaviour (conditional on `goalsReturnTo`)
```js
const dest = goalsReturnTo === 'newAccount' ? 'home' : goalsReturnTo;
flash(dest === 'home' ? 'Welcome to FORJD!' : 'Goals updated');
setState({screen: dest, goalsReturnTo: 'profile'});
```
`goalsReturnTo` defaults to `'profile'`; `signup` sets it to `'newAccount'` on successful
validation. The profile screen's binding is `goGoals: this.go('goals')` — it does **not**
set the key, it relies on the reset-to-`'profile'` on every exit. Worth knowing before porting.

### 4.7 Icons
Only the back chevron and the inline check path. No `icon()` calls.

### 4.8 Data backing
| Element | Class | Detail |
|---|---|---|
| `goals: string[]` (5 options) | **B** | Nothing in the contract. Needs `trainingGoals: string[]` (or an enum) on the profile, plus a `PATCH /api/v1/profile` field or a dedicated `/api/v1/profile/goals`. Seed `['Get stronger']`. |
| `acts: string[]` (6 options) | **B** | Same. `activities: string[]`. Seed `['Strength','Running']`. |
| `goalsReturnTo` | **C** (navigation state) | Do not port — `03-navigation.md` is right that this is go_router stack depth. |

**This screen is fully blocked on backend work.** It is also on the first-run path, so it
gates onboarding: shipping it read-only is not an option.

---

## 5. `notifs`

### 5.1 Chrome
- `hdr('Notifications', this.go('profile'))` → `profile`.
- **Tab bar shown**, Profile lit.
- Note: `notifsFeed` is a *different* screen with the same header title, backing out to `home`
  with the Home tab lit. Do not conflate them.

### 5.2 Exact copy
| String |
|---|
| `Notifications` |
| `Two rules: nothing at night, nothing you cannot act on.` |
| `Workout reminders` / `On your program days, 30 min before` |
| `Recovery alerts` / `When HRV or sleep drops sharply` |
| `PR celebrations` / `When you beat a lift or a run` |
| `Leaderboard moves` / `When your city rank changes` |
| `Weekly summary` / `Sunday evening recap` |
| `Quiet hours` |
| `22:00 — 07:00` (**em dash U+2014, spaces either side**) |
| `Change` |
| toast: `Edit quiet hours` |

### 5.3 Layout order
```
hdr
scroll ('0 22px 26px'):
  p    margin '0 0 8px'; font 400 13px/1.5; color #9a9a92
  five row(null, title, sub, null, toggle(...))   ← icon null, onClick NULL
  lbl('Quiet hours', {margin:'24px 0 10px'})
  card([...], {padding:'15px 16px'}):
    flex, align center, space-between
      left: flex align center gap 12 → icon('clock','#8b8b83',20)
            + span 'font 600 14px/1 Archivo, color #f6f5f3' '22:00 — 07:00'
      right: span 'font 600 12.5px/1 Archivo, color #e9712f, cursor pointer' 'Change'
tabbar('profile')
```

### 5.4 Toggle row detail
Because `onClick` is `null`, **the row itself is not tappable** — only the 46×27 track is.
So the row has no hover state and `cursor: default`. Each row is `padding '15px 2px'` with a
`1px solid rgba(255,255,255,.05)` bottom border, including the last one.
Title `600 14.5px/1.25 #f6f5f3`; sub `margin-top 3; 400 12px/1.3 #6e6e66`.

Toggle state values: see §1 `toggle()`. Defaults:
`{workout:true, recovery:true, pr:true, rank:false, weekly:true}` — **Leaderboard moves is off.**

### 5.5 Save behaviour
**There is no Save button on this screen.** Toggles apply immediately to state, and there is
no toast on toggle. The only toast is `Edit quiet hours`, fired by tapping `Change` — which is
a stub: it toasts and does nothing else. There is no quiet-hours editor screen.

### 5.6 Icons
`clock` at 20px, `#8b8b83`. Plus the `hdr` back chevron and the five tab-bar glyphs.

### 5.7 Data backing
| Element | Class | Detail |
|---|---|---|
| Workout reminders | **C** if reminders are scheduled locally from the program calendar (they can be — the trigger is "your program days, 30 min before", which the device knows). **B** if server-scheduled. |
| Recovery alerts | **B** — "when HRV or sleep drops sharply" requires server-side evaluation of ingested health data and a push. Needs a push-token endpoint + a `notificationPreferences` object. |
| PR celebrations | **C** if computed on-device at session end; **B** if pushed. |
| Leaderboard moves | **B** — rank changes are inherently server-computed. Requires push. |
| Weekly summary | **B** — same; a Sunday-evening server job. |
| Quiet hours `22:00 — 07:00` | **C** as a local scheduling window; **B** if the server must respect it when pushing. |

**Decision required:** whether FORJD Phase 1 has push at all. If it does not, all five are (C)
and this screen ships today as a device-local preferences page. If it does, three of five are
(B) and it needs `POST /api/v1/notifications/token` plus
`notificationPreferences: {workout, recovery, pr, rank, weekly, quietHours: {start, end}}` on
the profile.

---

## 6. `privacy`

### 6.1 Chrome
- `hdr('Privacy Settings', this.go('profile'))` → `profile`.
- **Tab bar shown**, Profile lit.
- Unusual structure: `hdr` → `scroll` → **pinned CTA bar** → `tabbar`. So the Save button sits
  between the scroll area and the tab bar, always visible.

### 6.2 Exact copy
| String |
|---|
| `Privacy Settings` |
| `You choose what leaves your phone. Health data never goes to advertisers.` |
| `Appear on city leaderboards` / `Your name and score are visible to others in your city.` |
| `Use approximate location` / `Assigns you to a city once. Never tracked in the background.` |
| `AI insights` / `Analyse your training and recovery to write your weekly insights.` |
| `Public profile` / `Let other athletes open your profile and see your PRs.` |
| `Crash diagnostics` / `Anonymous crash reports only — never health data.` (em dash) |
| `Permissions` |
| `Location permission` / `How your city is assigned` |
| `Preview my public profile` / `See exactly what other athletes see` |
| `Download my data` / `Export everything FORJD holds` |
| `Turning off AI insights stops new insights being generated. Your history stays on your device either way.` |
| `Save` |
| toast: `Export requested — we will email you` (em dash) |
| toast: `Privacy settings updated` |

`Analyse` is British spelling; the `goals` subtitle uses US `programs`. Inconsistent in the
prototype — copy it as-is or get a ruling.

### 6.3 Layout order
```
hdr
scroll ('0 22px 26px'):
  p  margin '0 0 8px'; font 400 13px/1.5; color #9a9a92
  five toggle rows — row(null, title, sub, null, toggle)      (not tappable rows)
  lbl('Permissions', {margin:'24px 0 2px'})
  row('pin',     'Location permission',       'How your city is assigned',        onClick)
  row('profile', 'Preview my public profile', 'See exactly what other athletes see', onClick)
  row('shield',  'Download my data',          'Export everything FORJD holds',    onClick)
      → these three have icons AND onClick, so: hover rgba(255,255,255,.025),
        trailing chevron (opacity .5, 18px, #8b8b83)
  card(..., {padding:'13px 14px', marginTop:16}):
    flex, gap 11
      icon('shield','#8b8b83',18) in a flex:none wrapper with margin-top 1
      text: font 400 12px/1.5 Archivo; color #6e6e66
CTA bar: flex:none; padding '12px 22px 24px';
         border-top 1px solid rgba(255,255,255,.06)     ← no background declared here
         btn('Save')
tabbar('profile')
```

### 6.4 Toggle defaults
`{leaderboard:true, location:true, ai:true, publicProfile:false, diagnostics:true}` —
**Public profile is the only one off by default.**

### 6.5 Row actions
| Row | Action |
|---|---|
| Location permission | `setState({screen:'location', locationReturnTo:'privacy'})` |
| Preview my public profile | `setState({screen:'athlete', athleteReturnTo:'privacy', viewAthlete:{name: profile.name, n:47, score:'92.7', priv:false, self:true}})` |
| Download my data | `flash('Export requested — we will email you')` — toast only, no request |

### 6.6 Save behaviour
`flash('Privacy settings updated')` then `this.go('profile')()`. Toggles already applied to
state on tap, so Save is a confirmation gesture, not a commit. Always enabled.

### 6.7 Icons
`pin` 22 `#8b8b83`, `profile` 22 `#8b8b83`, `shield` 22 `#8b8b83` (row icons),
`shield` 18 `#8b8b83` (footnote card), `chevron` 18 `#8b8b83` at .5 opacity (×3), `clock` none.

### 6.8 Data backing
| Element | Class | Detail |
|---|---|---|
| Appear on city leaderboards | **B** | A consent flag that must gate a server behaviour (whether you appear in the leaderboard query). Storing it client-side is a privacy bug. Needs `privacySettings.leaderboardVisible: boolean` on the profile. |
| Use approximate location | **B** | Same — it gates whether the server accepts/keeps a city assignment. Also has an OS permission dimension (C) that is separate from the consent flag. |
| AI insights | **B** | Gates whether the insight-generation job runs for this user. Server-side by definition. |
| Public profile | **B** | Gates the athlete-profile read endpoint. **And the endpoint does not exist**, nor does the `athlete` screen's backing data. |
| Crash diagnostics | **C** (with a caveat) | The only genuinely device-local one — it toggles the crash SDK. CLAUDE.md rule 15 means the SDK must never see health data regardless of this toggle's position; the toggle is not the enforcement mechanism. |
| Location permission row | **C** (navigates to `location`) | Pure navigation. |
| Preview my public profile | **B** | Depends on the `athlete` screen and a public-profile read endpoint. |
| Download my data | **B** | Needs `POST /api/v1/me/export` (and, given health data, probably an async job + email). The toast currently lies — nothing is requested. |

**Recommended shape:** `privacySettings: { leaderboardVisible, locationEnabled, aiInsights,
publicProfile, crashDiagnostics }` on `profileResponseSchema` / `updateProfileRequestSchema`,
with each flag *also* read at the point of behaviour (CLAUDE.md rule 12 logic — the toggle is
a stored consent, the guard is where it is enforced).

---

## 7. `location`

### 7.1 Chrome
- **No `hdr`.** A bare chevron in its own bar, styled differently from `goals`:
  ```
  wrapper: border-bottom 1px solid rgba(255,255,255,.07); padding '0 22px'
  hit box: 34×34; margin '0 0 8px -8px'   (8px bottom, vs hdr's 10px)
  no border-radius, no hover rule declared
  svg 20×20, path 'M12.5 4 6.5 10l6 6', stroke #f6f5f3, sw 1.7
  ```
  This is the only one of the six with a **bottom rule under the chevron**.
- **Tab bar shown**, and it follows the origin: `tabbar(back==='rank' ? 'rank' : 'profile')`.
- Back destination: `this.go(back)` where `back = state.locationReturnTo || 'rank'`.
  Default `'rank'`; `privacy` sets `'privacy'`.

### 7.2 Exact copy
| String |
|---|
| `City Leaderboard Location` |
| `FORJD uses your approximate location to assign you to a city leaderboard. Your precise location is never stored or shared.` |
| `Why is location used?` / `To place you in the correct city leaderboard automatically.` |
| `When is it used?` / `Once during setup. Not tracked in the background.` |
| `What if you decline?` / `You will not appear on any city leaderboard. Everything else in FORJD still works normally.` |
| `Allow Location` |
| `Not Now` |
| toast: `Assigned to Alexandria` |

### 7.3 Layout order
```
chevron bar (see 7.1)
body: flex:1; min-height 0; overflow-y auto; padding '26px 22px 0'; column
      ← this is a hand-rolled scroller, NOT scroll(); different padding
  icon tile: 44×44; border-radius 12; background #1c1d20; centred
             icon('pin','#c8c8c0',22)          ← #c8c8c0, another one-off grey
  h1  margin '20px 0 0'; font 700 24px/1.2 Archivo; letter-spacing -.02em
      ← 24px, NOT the 26px hdr/goals title size. No explicit color (inherits #f6f5f3).
  p   margin '12px 0 24px'; font 400 13px/1.55; color #9a9a92
  Q&A block: flex column; gap 18
    question: font 700 13px/1.3; color #f6f5f3
    answer:   margin-top 6; font 400 12.5px/1.5; color #6e6e66
  spacer: flex 1; min-height 30
  CTA block: flex column; gap 11; padding-bottom 18
    btn('Allow Location')      primary
    btn('Not Now', …, 'ghost') ghost
tabbar(back==='rank'?'rank':'profile')
```

### 7.4 Button behaviour
- `Allow Location` → `flash('Assigned to Alexandria')` then `setState({screen: back})`.
  **No OS permission prompt is modelled**, and no denied path exists.
- `Not Now` → `this.go(back)`, no toast.
Both land on the same destination. No error, disabled or pressed variation beyond the shared
`btn()` rules.

### 7.5 Icons
`pin` 22px `#c8c8c0` in the 44px tile. Plus the inline back chevron and the tab bar.

### 7.6 Data backing
| Element | Class | Detail |
|---|---|---|
| The whole explainer screen | — | Static copy, buildable immediately. |
| OS location permission | **C** | Device permission; `geolocator`/`permission_handler`. Not synced. |
| "Assigned to Alexandria" — the resulting city | **B** | Nothing in the contract stores a city. Needs `city` (or `leaderboardRegionId`) on the profile, written by a `POST /api/v1/profile/location {lat, lon}` that resolves coarse coordinates server-side. Note the prototype hard-codes `Alexandria` and never sends coordinates. |
| `priv.location` consent flag | **B** | See §6 — set here implicitly by "Allow", but the prototype does **not** actually write `priv.location` from this screen. That is a prototype gap, not a design decision. |
| `locationReturnTo` | **C** | Navigation state. Do not port. |

---

## 8. The `sex` enum mismatch — confirmed, and it is real

**Prototype** (`s_editProfile`): `this.chips(['Male','Female','Rather not say'], p.sex, …)` —
**three** options, Title Case, stored verbatim as the profile value (seed: `'Male'`).

**Contract** (`packages/contracts/src/index.ts:83`):
`export const sexSchema = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);` —
**four** values, snake_case.

The exact mismatch:

| Contract value | Design chip | Status |
|---|---|---|
| `male` | `Male` | maps cleanly |
| `female` | `Female` | maps cleanly |
| `other` | *(nothing)* | **No chip exists.** A user whose stored value is `other` has no selected chip to render, and can never set it. |
| `prefer_not_to_say` | `Rather not say` | maps, but only by convention — the label is not the value |

`01-screen-inventory.md` says "Flutter renders four to match `sexSchema`", i.e. the shipped
screen already diverges from the prototype by adding an `Other` chip. That is the right call
(a nullable enum with an unreachable member is a bug), but it means **the prototype is not the
spec for this control** — it is four chips, and the fourth needs a label decision (`Other` is
the obvious one and is what the handoff implies).

Also: the contract's `sex` is `.nullable()`, so "no chip selected" is a valid state the
prototype never shows.

---

## 9. Doc-vs-prototype discrepancies (the traps)

Confirmed disagreements between `design_handoff_forjd_mobile/*` and the prototype.
**Prototype wins in every case below.**

| # | Doc claim | Prototype | Severity |
|---|---|---|---|
| 1 | `05-interactions.md`: selected option row fill is `rgba(233,113,47,.09)`; `01-screen-inventory.md` repeats `.09` for `goals` | `rgba(233,113,47,.1)` in `s_goals`. `.09` appears nowhere in these six screens. | Low but it is a token — get it right once |
| 2 | `05-interactions.md`: "selected chip → accent fill, **`#101011` label**" | `chips()` sets `color:'#fff'` when active | Medium — `#101011` on `#e9712f` is a *dark* label; `#fff` is a light one. Visually different. |
| 3 | `05-interactions.md`: "toggle on → knob at **`x: 21`**" | `translateX(19px)` (track 46, padding 3, knob 21 → 46−3−21−3 = 19). 21 would overflow. | Medium — 21 is arithmetically wrong |
| 4 | `05-interactions.md`: "**disabled — does not exist in this design**" | `s_goals` disables Save via `opacity .4` + `pointerEvents:'none'` when either list is empty | High — it is the one disabled state, and it is on the onboarding path |
| 5 | `01-screen-inventory.md` privacy section lists **two** permission rows (Location permission, Download my data) | There are **three** — `Preview my public profile` sits between them | High — a whole row omitted from the handoff |
| 6 | `01-screen-inventory.md`: `units` has "four **segmented controls**" | Four two-up flex rows of pill buttons with their own style (radius 10, `11px 0` padding, unselected `#17181a`/`#f6f5f3`). `segStyle()` (height 38, radius 9, `#232326`) exists but is **not used here** | Medium — different height, radius, and unselected treatment |
| 7 | `01-screen-inventory.md`: `editProfile` Birthday "borrows the `clock` glyph because there is no `calendar`" | The prototype date input has **no icon at all** — it is a native `<input type="date">` with `colorScheme:'dark'` | Low — the doc is describing the shipped Flutter screen, but it reads as prototype spec |
| 8 | `01-screen-inventory.md`: `editProfile` sex is three chips | Three in the prototype, but the doc then says Flutter renders four. Both statements are in the same sentence. | See §8 — resolve deliberately |
| 9 | `03-navigation.md` route graph shows `signup ──▶ goals ──▶ home` | Correct for Save. But **back** from `goals` in that state goes to `signup`, which the graph does not show | Medium — a first-run user can chevron back into the signup form |
| 10 | `05-interactions.md` toast table: "Plan switched → `Switched to {term}`" | Actual string is `'Switched to '+label(other)+' plan'` → e.g. `Switched to Monthly plan` (trailing " plan") | Low, and outside these six screens (`managePlan`) |

Two more the docs get **right** and are worth confirming because they look wrong:
- `location`'s tab bar really does change tab based on origin.
- `notifs` and `privacy` really do show the tab bar while `editProfile`, `units` and `goals` do not.

---

## 10. Recommended build order

1. **`location`** — pure static explainer. Zero backend dependency for everything except the
   "Allow" write, which can no-op behind a TODO. Ships the shared chevron-bar + ghost-button
   pattern and the origin-aware tab bar. Lowest risk, immediate visible progress.
2. **`editProfile`** minus the Plan row — Name/Birthday/Sex are all (A). Ship the Plan row as
   a hard-coded `Free plan` that navigates to `pro`, or hide it entirely behind a flag.
   Resolve the sex enum (§8) before writing the widget, not after.
3. **`units`** with only *Measurement system* live — the other three controls render, derive
   from `unitSystem`, and are either read-only or need a product decision (§3.8).
4. **`notifs`** as a device-local preferences screen — *if and only if* the push decision (§11)
   lands as "no server push in Phase 1". Otherwise defer with `privacy`.
5. **`privacy`** — needs `privacySettings` on the contract first. Do the backend slice, then
   the screen. The `Preview my public profile` row should be cut from the first build; it
   depends on a screen and an endpoint that do not exist.
6. **`goals`** last of the six as a *screen*, but its **backend field is the highest-priority
   backend work** because it sits on the first-run path. Build `trainingGoals`/`activities`
   into the contract early; build the screen once they land.

Backend work in priority order: `trainingGoals` + `activities` → `privacySettings` →
`city`/location assignment → `subscription` → `notificationPreferences` → data export.

---

## 11. Open questions that need a human

1. **Sex enum, four chips or three?** The contract has `other`; the prototype does not offer it.
   Adding an `Other` chip is a design change to a shipped-looking screen. Confirm the label
   ("Other"?) and the ordering, and confirm whether unselected/null is a renderable state.
2. **Does Phase 1 have push notifications at all?** This flips `notifs` between "buildable
   today, device-local" and "blocked on a push token endpoint plus a preferences object".
   It also decides whether Quiet hours is a local scheduling window or a server contract.
3. **Are Weight/Distance/Energy independent of `unitSystem`?** The prototype lets you pick
   `lb` while the system says `Metric`. Either that inconsistency is intended (three real
   preferences) and needs three new fields, or it is a prototype bug and they should be
   strictly derived. Energy in particular cannot be derived from `unitSystem` at all.
4. **`Public profile` and the `athlete` screen.** The toggle promises a profile other athletes
   can open. No such endpoint exists and the handoff itself flags this. Cut the toggle for
   now, or commit to the endpoint?
5. **`Download my data`** currently toasts a promise it does not keep. Given this is health
   data, is a GDPR-style export in scope, and is it async-plus-email as the copy implies?
6. **Copy consistency:** `Analyse` (privacy, British) vs `programs` (goals, US). Pick a locale.
7. **Toggle tap targets.** In `notifs` and `privacy` the row is *not* tappable — only the 46×27
   track is. `05-interactions.md`'s own accessibility section calls for a 44px minimum. Should
   Flutter make the whole row tap-to-toggle? That is a behaviour change from the prototype.

---

## 12. Things I could not determine

- **`heightCm` has no screen.** The contract supports it; none of these six edit it, and I
  found no other screen that does. If it is meant to be on `editProfile`, that is a net-new
  field with no design.
- **`avatarUrl` has no control.** `profile` renders a 52px avatar *tile* (`#1C1D20`, radius 14),
  but nothing in `editProfile` uploads or changes an image. Whether the tile is an initial, an
  image, or a placeholder is not resolvable from the prototype source I read.
- **`profile.handle` and `profile.city`** are in prototype state and rendered on `profile`
  (`@jmitch · Alexandria`) but are not editable on `editProfile` and have no contract field.
  The handoff notes the shipped Flutter screen substitutes the email into that slot. Whether
  handles are a real product concept is unanswered.
- **Pressed/active states** are only declared on the primary `btn()` (`scale(.985)`). Chips,
  toggles, option rows, the plan row and the units pills declare *no* pressed state at all.
  I have reported that absence rather than inventing values.
- **The `Change` control on quiet hours** goes nowhere — it toasts `Edit quiet hours` and stops.
  There is no quiet-hours editor anywhere in the prototype.
- I did **not** read the whole 300KB file; I extracted the six screen functions, every shared
  primitive named in the brief, the initial state object, the constants block, and the
  view-model binding tail. If a value is not quoted above, I did not find it — I have not
  guessed any.
