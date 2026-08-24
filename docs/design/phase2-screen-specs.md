# Phase 2 screen specs — exercise library, detail, and custom exercise

> **Source of truth: the runnable prototype**, `FORJD mobile app design/FORJD Mobile.dc.html`.
> Every value below was extracted with a brace-matching script over the prototype's own render
> methods, not read off a screenshot and not paraphrased from
> `design_handoff_forjd_mobile/*.md`. Where the handoff markdown disagrees with the prototype,
> **the prototype wins** — see §7, which lists the disagreements found this time.
>
> Prototype line numbers are given per screen so a value can be re-checked in seconds.
> The prototype is ~305 KB / 3,239 lines; extract from it with a script rather than reading it
> whole.

## 1. Tokens

From prototype line 912, verbatim:

```js
const O='#e9712f', GRN='#79b98a', W='#f6f5f3', DIM='#9a9a92',
      DIMMER='#6e6e66', CARD='#17181a',
      BRD='1px solid rgba(255,255,255,.07)';
```

| Token | Value | Role |
|---|---|---|
| `O` | `#e9712f` | accent / primary |
| `GRN` | `#79b98a` | positive |
| `W` | `#f6f5f3` | text primary |
| `DIM` | `#9a9a92` | text secondary |
| `DIMMER` | `#6e6e66` | text tertiary |
| `CARD` | `#17181a` | surface |
| `BRD` | `1px solid rgba(255,255,255,.07)` | hairline border |

Colours appearing inline in these screens that are **not** in that constant list, and so need
checking against `theme/tokens.ts` before use — add a token, never inline a hex:
`#151517` (input/search field background), `#1c1d20` (list-row icon tile), `#191a1c` (unselected
chip background), `#1b1c1e` (tag pill background), `#8b8b83` (list icon stroke), `#6e6e66`
(search glyph), `#a9a9a1` (row trailing value), `#b4b4ac` (history date), `#77776f` (`lbl`
colour), `#5c5c55` (helper text), `#5d5d57` (placeholder), `#c9503c` (destructive),
`rgba(255,255,255,.05)` (row divider — note this is *lighter* than `BRD`).

The app-wide **ember atmosphere** applies here as on every screen — it is the default set in
code, not in any screen's own styles. Use the existing `ScreenBackground` component; do not
transcribe the flat background colour alone.

## 2. Shared primitives

These already exist in the prototype and most already have React Native equivalents. Reuse the
built components (`components/header.tsx`, `components/tab-bar.tsx`, `components/icon.tsx`)
rather than re-deriving.

**`hdr(title, onBack, right)`** — line 1131. Container padding `2px 22px 14px` with a back
chevron, `2px 22px 12px` without. Back button 34x34, margin `0 0 10px -8px`, radius 10,
hover `rgba(255,255,255,.06)`; chevron is a 20x20 SVG, `M12.5 4 6.5 10l6 6`, stroke `W`,
width 1.7, round caps. Title row is `space-between`; `h1` is `700 26px/1.15 Archivo`,
letter-spacing `-.02em`, colour `W`, `white-space: nowrap`. `right` renders at the row's end.

**`lbl(text, extra)`** — line 1130. `600 9.5px/1 Archivo`, letter-spacing `.14em`,
uppercase, colour `#77776f`.

**`btn(text, onClick, kind)`** — line 1319. Base: height 52, radius 12, centred,
`700 15.5px/1 Archivo`, letter-spacing `.01em`, transition `transform .12s, filter .12s`.
Primary: background `O`, colour `#fff`, `box-shadow: 0 6px 22px rgba(233,113,47,.22)`,
hover `brightness(1.07)`, active `scale(.985)`. Ghost: transparent, `BRD`, colour `DIM`,
weight 600.

> The primary button's shadow is the one slice 2 fought: four screens set an **opaque**
> `shadowColor` inline, fighting the translucent `shadow-primary-button` token. Use the token.

**`chips(items, active, onPick, extra)`** — line 1334. Row is `flex`, `gap: 8`, `flex-wrap`.
Each chip: padding `8px 15px`, radius 9, `600 12.5px/1 Archivo`; active `background: O`,
`border: 1px solid O`, colour `#fff`; inactive `background: #191a1c`, `BRD`, colour `DIM`;
`transition: background .15s`.

**`card(children, extra)`** — line 1129. `background: CARD`, `BRD`, radius 14.

**`tabbar(active)`** — line 1392. Height 76, `border-top: 1px solid rgba(255,255,255,.07)`,
`background: rgba(14,14,15,.96)`, `backdrop-filter: blur(12px)`, padding `10px 6px 0`. Five
items, icon 22 then label `10px/1 Archivo` (weight 600 active / 500 inactive), colour `O` when
active and `#6b6b64` otherwise. **Library, exercise detail and new-exercise all render the tab
bar with `train` active**, so use `<TabBar active="train" />`.

---

## 3. `library` — Exercise Library

Prototype `s_library()`, line 1659.

### 3.1 Data and filtering

```js
const f = state.libFilter, q = state.libQuery.toLowerCase();
const match = (r) => (f==='All' || (f==='Favourites' ? isFav(r[0]) : r[3]===f))
                     && r[0].toLowerCase().includes(q);
const list   = all.filter(match);
const recent = f==='Favourites' ? [] : all.slice(0,3).filter(match);
```

Two things to carry over faithfully and one to correct:

- Search is a **case-insensitive substring match on the name only** — not on muscles or
  equipment. Phase 2 replaces this with FTS5, which is a deliberate upgrade, not a fidelity
  break; keep substring behaviour as the floor (typing `bench` must still match `Bench Press`).
- The `Favourites` filter **suppresses the Recent section entirely**.
- **`Recent` is not real recency in the prototype** — it is literally `all.slice(0,3)`, the
  first three rows of the seed array. Phase 2 must back it with genuine recency (last-opened or
  last-performed). Until Phase 3 supplies session history, drive it from last-opened, stored
  locally.

### 3.2 Header

`hdr(title, onBack, right)` where:

| Mode (`state.libraryPickMode`) | Title | Back goes to |
|---|---|---|
| `false` (browse) | `Exercise Library` | `train` |
| `'builder'` | `Add Exercise` | `builder` |
| any other truthy | `Add Exercise` | `live` |

`right` is the accent **New** pill: height 34, padding `0 12px`, radius 10, background
`rgba(233,113,47,.14)`, hover `rgba(233,113,47,.26)`, `gap: 6`. Inside, a 14x14 SVG plus
(`M12 5.6v12.8M5.6 12h12.8`, stroke `O`, width 2, round caps) and the label `New` in
`700 11.5px/1 Archivo`, colour `O`, `white-space: nowrap`.

> The glyph is drawn inline in the prototype, but `components/icon.tsx` already carries a
> `plus` — check the path matches before adding a second one.

### 3.3 Search box

Wrapper `flex: none`, padding `0 22px 12px`.

Box: height 46, radius 11, background `#151517`, `BRD`, `flex` row, `gap: 10`, padding `0 14px`.
Contains the `search` glyph at `#6e6e66`, size 18, then an input bound to `state.libQuery`:
`flex: 1`, no background/border/outline, `500 14px Archivo`, colour `W`.

**Placeholder: `Search exercises…`** — with a real ellipsis character (U+2026), not three dots.

### 3.4 Filter chips

`margin-top: 12`, via `chips(...)`. Eight, in this exact order:

```
All · Favourites · Strength · Running · Cross Training · Yoga · Calisthenics · Mobility
```

**`Favourites` is the second chip.** The handoff markdown omits it — see §7.

Default value of `libFilter` is **`All`** (it was `Running` in an earlier prototype revision and
was corrected by the design audit; `06-audit-log.md:59`).

### 3.5 List rows

Sections in order: `Recent` (`lbl` with `margin: 6px 0 2px`, rendered only when non-empty), then
`All exercises` (`lbl` with `margin: 20px 0 2px`).

Row: `flex` row, `align-items: center`, `gap: 13`, padding `13px 0`,
`border-bottom: 1px solid rgba(255,255,255,.05)`, hover `background: rgba(255,255,255,.025)`.

| Slot | Spec |
|---|---|
| Icon tile | 38x38, radius 9, background `#1c1d20`, centred, `flex: none`; `dumb` glyph at `#8b8b83`, size 20 |
| Title | `600 14.5px/1 Archivo`, colour `W` |
| Subtitle (muscles) | `margin-top: 5`, `400 11.5px/1 Archivo`, colour `DIMMER` |
| Star | 32x32, radius 9, centred, `flex: none`, hover `rgba(255,255,255,.07)`; `starIcon(isFav, 19)` |
| Trailing value | right-aligned, `500 12px/1 Archivo`, colour `#a9a9a1`, `font-variant-numeric: tabular-nums` |
| Chevron | under the value, `margin-top: 4`, right-aligned, `opacity: .5`, `chevron` at `#8b8b83`, size 15 |

The title/subtitle column is `flex: 1; min-width: 0` — required, or a long exercise name pushes
the trailing value off the row.

The star's handler must **stop propagation**; in the prototype it is a nested `onClick` inside
the row's own handler, and a naive React Native port makes tapping the star also open the
exercise.

### 3.6 Row tap — three modes

```js
if (pick === 'builder')  -> append {name, sets:3, reps: measure==='time' ? 45
                                                 : measure==='distance' ? 500 : 10}
                            -> screen 'builder', toast "<name> added to routine"
else if (pick)           -> append sessionEx(name,1,null)
                            -> screen 'live',    toast "<name> added to workout"
else                     -> screen 'exercise', exerciseReturnTo:'library'
```

Port `libraryPickMode` as an expo-router **search param** (`/library?pick=workout|routine`), not
component state — this is what `04-state-and-data.md` itself recommends, and it matches the
`returnTo`/`back` param pattern established by `goals` and `location` in slice 2.

The builder/live destinations do not exist until Phase 3. In Phase 2, **only the browse mode is
reachable**; build the param plumbing and the two pick titles, and leave the destinations to
Phase 3 rather than inventing screens for them.

### 3.7 Empty states

Both are `padding: 26px 0`, `400 13px Archivo`, colour `DIMMER`:

- Favourites filter, nothing starred → `No favourite exercises yet — tap a star to add one.`
- Any other filter, no match → `No exercises match.`

Note the em-dash in the first. The handoff markdown records only the second.

### 3.8 Bottom

`tabbar('train')`.

---

## 4. `exercise` — Exercise detail (strength)

Prototype `s_exercise()`, line 1783.

**The running variant is chosen by category, not by route:**

```js
if (meta[3] === 'Running') return this.s_exerciseRun(tags);
```

One route, `/exercise/[id]`, branching internally on `category === 'Running'`.

`tags` = the muscle list split on ` · `, plus the exercise's goal appended.

### 4.1 Header

`hdr(name, back -> exerciseReturnTo || 'library', right)`. The `right` cluster is `flex`,
`align-items: center`, `gap: 4`, and its contents are **conditional on the exercise being
custom**:

| Control | Shown when | Spec |
|---|---|---|
| `pencil` | custom only | padding 5, margin -5, radius 10, hover `rgba(255,255,255,.06)`, icon `#8b8b83` @20 |
| `x` (delete) | custom only | same box, hover `rgba(201,80,60,.14)`, icon `#c9503c` @20 |
| star | always | same box, hover `rgba(255,255,255,.06)`, `starIcon(isFav, 22)` |

### 4.2 Body

1. **Tag pills** — `flex`, `gap: 7`, wrap, `margin-bottom: 14`. Each: padding `6px 11px`,
   radius 7, background `#1b1c1e`, `BRD`, `500 11.5px/1 Archivo`, colour `DIM`.
2. **Equipment block** — rendered only when `toolsOf(name)` is non-empty. `margin-bottom: 14`.
   Label `Equipment` in `600 9.5px/1 Archivo`, letter-spacing `.12em`, uppercase, colour
   `#5c5c55`, `margin-bottom: 8` — note this is `.12em`, **not** `lbl`'s `.14em`, and a
   different colour. Pills: `flex` row `gap: 6`, padding `6px 11px`, radius 7, background
   `rgba(233,113,47,.1)`, border `1px solid rgba(233,113,47,.25)`, `600 11.5px/1 Archivo`,
   colour `O`, each led by the `dumb` glyph at `O`, size 13.
3. **Two stat tiles** — `flex`, `gap: 10`: `Best set 100 kg x 3` and
   `Est. 1RM 106 kg` with sub-line `+5 kg this month`.
4. **Sparkline card** — `card` with padding `15px 16px`, `margin-top: 12`; label
   `Top set — last 8 sessions` (`margin-bottom: 14`), then a sparkline in `O`, 300x80.
5. **History list** — `lbl('History', {margin:'22px 0 2px'})`, then rows: `space-between`,
   `align-items: center`, padding `13px 0`, `border-bottom: 1px solid rgba(255,255,255,.05)`.
   Date `500 13px/1 Archivo` `#b4b4ac`; value `500 12.5px/1 Archivo`, tabular-nums, colour `O`
   when it contains `PR` else `DIM`.

> **Items 3, 4 and 5 are all Phase 3 data.** Per the plan's Phase J, omit them entirely rather
> than rendering zeros — the same call already made for the athlete screen's stat tiles. Phase 2
> ships the header, tags, equipment block and (new) the instructions, which the prototype's
> placeholder catalogue had no field for.

### 4.3 Delete confirmation sheet

Overlay: `position: absolute; inset: 0`, background `rgba(10,10,11,.72)`, `align-items:
flex-end`, `z-index: 20`.

Sheet: full width, background `#17181a`, `border-top: BRD`, radius `18px 18px 0 0`, padding
`20px 22px 24px`, column, `gap: 14`.

- Title `700 18px/1.2 Archivo`, colour `W`: `Delete exercise?`
  (built as `'Delete ' + kind.toLowerCase() + '?'`)
- Body `400 13px/1.5 Archivo`, colour `DIMMER`:
  `"<name>" will be permanently removed. This can't be undone.`
  — curly quotes and a curly apostrophe in the original.
- Buttons row `gap: 9`, `margin-top: 6`, both `flex: 1`, height 52, radius 12:
  **Cancel** (`BRD`, colour `W`, hover `rgba(255,255,255,.05)`) and
  **Delete** (background `#c9503c`, colour `#fff`, hover `brightness(1.08)`), both
  `700 14px/1 Archivo`.
- On delete: remove, return to `exerciseReturnTo || 'library'`, toast `Exercise deleted`.

> **Deliberate deviation (see §8):** we soft-delete, so the words "permanently removed" and
> "can't be undone" would be untrue. Reword.

---

## 5. `exerciseRun` — Exercise detail, running variant

Prototype `s_exerciseRun(tags)`, line 1826.

Header: same as §4.1 but with **only the star** — no pencil, no delete.

Body, in order:

1. Tag pills, same styling as §4.2, with `'Running'` appended to `tags`.
2. Two stats: `Best time 23:42` (sub-line `16 Aug`) and `Avg pace <paceToUnit('4:52')>` with
   unit `/<distUnit()>` and sub-line `-8 s/<distUnit()> this month`. **The unit comes from the
   user's `distanceUnit` preference** — bind to the real field, not `unitSystem` (ADR-016).
   The minus in the original is U+2212, not a hyphen.
3. Route map placeholder: height 150, radius 14, `overflow: hidden`, `position: relative`,
   `background: repeating-linear-gradient(135deg,#141517 0 9px,#191a1c 9px 18px)`, `BRD`,
   `margin-top: 12`. Inside, an SVG `viewBox="0 0 340 150"`, `preserveAspectRatio="none"`:
   - path `M28 128 C70 108 60 76 104 66 C150 56 168 84 208 70 C250 56 262 30 312 26`,
     no fill, stroke `O`, width 3, round caps and joins
   - start circle `cx28 cy128 r5`, fill `#101011`, stroke `O` width 2
   - end circle `cx312 cy26 r5`, fill `O`
   - caption `last route` at `left: 11; bottom: 9`,
     `500 10px/1 ui-monospace, Menlo, monospace`, colour `#6e6e66`
4. Sparkline card: label `Pace trend — 8 runs`, sparkline in **`GRN`** (not `O`), 300x80,
   card padding `15px 16px`, `margin-top: 12`.
5. `Recent runs` (`lbl`, `margin: 24px 0 2px`), rows `gap: 10`, padding `13px 0`, divider
   `rgba(255,255,255,.05)`: date column fixed `width: 52`, `flex: none`,
   `500 12.5px/1 Archivo` `#b4b4ac`; middle `flex: 1`, `600 13px/1 Archivo`, colour `W`,
   tabular-nums, rendered as `<distance> · <time>`; right `500 12px/1 Archivo`, tabular-nums,
   colour `O` when a PB else `DIM`, rendered as `<pace>` plus `' PB'`.
6. CTA `margin-top: 16`: primary `btn('Start Run')`.

Then `tabbar('train')`.

> Items 2-6 are all Phase 3/6 data. Phase 2 ships the header and tags; everything below is
> omitted, exactly as in §4.2.

---

## 6. `newExercise` — Custom exercise create **and** edit

Prototype `s_newExercise()`, line 2838. One screen serves both; `state.editingExercise` decides.

Header: `hdr(editing ? 'Edit Exercise' : 'New Exercise', back -> 'library')`. No right slot.

### 6.1 Fields, in order

1. **Exercise name** — `lbl('Exercise name', {marginBottom:9})`, then an input: full width,
   height 50, radius 11, background `#151517`, `BRD`, padding `0 15px`,
   `600 14.5px Archivo`, colour `W`, no outline.
   Placeholder: `e.g. Landmine Press`.
2. **Muscles worked** — `lbl(..., {margin:'24px 0 4px'})`, helper line `Pick one or more`
   (`margin: 0 0 10px`, `400 11px/1.4 Archivo`, colour `#5c5c55`), then a wrapping multi-select:
   ```
   Chest · Back · Shoulders · Biceps · Triceps · Forearms · Core ·
   Glutes · Quads · Hamstrings · Calves · Hips · Full Body
   ```
3. **Equipment used** — identical structure and helper copy:
   ```
   Barbell · Dumbbell · Kettlebell · Machine · Cable · Band ·
   Bodyweight · Bench · Rack · Medicine Ball · TRX · Sled
   ```
4. **Description** — helper `Optional — cues, setup or form notes`. Textarea: full width,
   `min-height: 96`, `rows: 4`, `resize: none`, radius 11, background `#151517`, `BRD`,
   padding `13px 15px`, `400 13.5px/1.6 Archivo`, colour `W`.
   Placeholder: `e.g. Brace the core, elbows tucked at 45°, drive through the mid-foot.`
5. **Category** — `lbl(..., {margin:'24px 0 10px'})`, single-select, wrapping, `gap: 8`:
   `Strength · Running · Cross Training · Calisthenics · Yoga · Mobility`.
   Each: padding `9px 14px`, radius 9, `600 12.5px/1 Archivo`; selected background `O`,
   border `1px solid O`, colour `#fff`; unselected `#191a1c`, `BRD`, colour `DIM`.
   **Note the order differs from the library's chip row** — here Calisthenics precedes Yoga.
6. **Measured by** — `lbl(..., {margin:'24px 0 10px'})`, a three-up equal-width row, `gap: 8`:
   `Weight × reps` (`weight`), `Time` (`time`), `Distance` (`distance`). Each: `flex: 1`,
   `min-width: 0`, centred, padding `12px 6px`, radius 10, `600 12px/1.2 Archivo`; selected
   background `rgba(233,113,47,.13)`, border `1px solid O`, colour `O`; unselected `CARD`,
   `BRD`, colour `#b4b4ac`, hover `border-color: rgba(233,113,47,.45); color:#f6f5f3`.
7. **Helper footnote** — `margin: 14px 0 0`, `400 11.5px/1.5 Archivo`, colour `#5c5c55`:
   `Time-based exercises get a set timer during a live workout; distance exercises log metres.`

**Multi-select chip styling** (muscles and equipment alike): `flex` row, `align-items: center`,
`gap: 7`, padding `9px 13px`, radius 9, `600 12.5px/1 Archivo`. Selected: background
`rgba(233,113,47,.13)`, border `1px solid O`, colour `O`, **and a leading 11x11 check SVG**
(`m5.6 12.4 4 4 8.8-9`, stroke `O`, width 3, round caps/joins). Unselected: background
`#191a1c`, `BRD`, colour `DIM`, hover `border-color: rgba(233,113,47,.45); color:#f6f5f3`.

### 6.2 Save bar

Fixed footer: `flex: none`, padding `12px 22px 24px`,
`border-top: 1px solid rgba(255,255,255,.06)`. Contains the primary `btn`, labelled
`Save Changes` when editing and `Save Exercise` otherwise, wrapped in a div whose
**`opacity` is `1` when ready and `.5` when not**.

`ready = name.trim() && muscles.length && tools.length && cat && measure`

**The button is dimmed but still tappable** — validation happens on press, in this exact order,
each returning early with a toast:

| Order | Condition | Toast |
|---|---|---|
| 1 | name blank | `Give the exercise a name first` |
| 2 | no muscle | `Pick at least one muscle worked` |
| 3 | no equipment | `Pick at least one piece of equipment` |
| 4 | name collides (case-insensitive, excluding the row being edited) | `An exercise with that name already exists` |

On success: build the row, prepend it, return to `library`, toast
`<name> added to your library` — or `<name> updated` when editing.

Note the goal is **derived, not chosen**:

```js
const goal = n.measure === 'weight' ? 'Hypertrophy' : 'Muscular endurance';
```

and muscles default to `Full Body` when the list is somehow empty.

> Keep the dimmed-but-tappable behaviour and the ordered toasts. A disabled button that does
> nothing tells the user less than a toast naming the first missing field, and
> `05-interactions.md` is wrong that this design has no disabled state — `goals` disables Save
> at `opacity .4`, and this screen dims at `.5`.

---

## 7. Where the handoff markdown disagrees with the prototype

Found this pass, in addition to the ten recorded in `slice2-screen-specs.md`:

1. **The `Favourites` chip is missing from the docs.** `01-screen-inventory.md:242` lists the
   filter chips as *All · Strength · Running · Cross Training · Yoga · Calisthenics · Mobility*.
   The prototype has **`Favourites` second**, and `s_library` has dedicated branches for it
   (Recent suppressed, different empty-state copy).
2. **The Favourites empty state is missing.** `05-interactions.md:116` records only
   `"No exercises match."`, not `"No favourite exercises yet — tap a star to add one."`
3. **The screen inventory omits `newExercise` and `favorites` entirely**, though both are in
   `SCREENS_B` (line 916) with real implementations. The handoff README's "Phase 2 =
   `library` + `exercise` + `exerciseRun`" mapping therefore undercounts Phase 2 by the whole
   custom-exercise flow — which the library header's own **New** button links straight to.
4. **The favourites destination screen is dead code.** `s_favorites()` (line 2780) computes
   `libraryAll().filter(r => isFav(r[0]))` and defines an `exRow` renderer, then **renders
   neither** — its tree contains only the programs and workouts sections. Starring an exercise
   produces a favourite with nowhere to view it except the library's own `Favourites` chip.
   This is a prototype bug, not a spec: the library chip is the real destination, and no
   separate favourites screen is in Phase 2's scope.
5. **The whole bundle is written for the pre-pivot Flutter stack** — its README says
   *"Target: `apps/mobile` (Flutter)"* and `04-state-and-data.md` routes persisted state to
   Drift, controller state to Riverpod, navigation to go_router. Read those columns as
   "persisted repository" / "component state" / "expo-router" (ADR-013).

## 8. Deliberate deviations for Phase 2

Each is a decision, not an oversight, and belongs in the roadmap's deviations list:

- **Delete copy is reworded.** We soft-delete so Phase 3 session history keeps its foreign key.
  "will be permanently removed. This can't be undone." would be false; say the exercise is
  removed from the library instead.
- **`Recent` is backed by real recency**, not `all.slice(0,3)`. The prototype's version is a
  stand-in for data it did not have.
- **Search covers more than the name.** The prototype substring-matches names only; FTS5 also
  indexes muscles and equipment. Substring-on-name remains the floor.
- **Stat tiles, sparklines and history are omitted** from both detail variants until Phase 3
  supplies session data — not rendered as zeros, which reads as a bug.
- **Only browse mode is reachable.** `?pick=` plumbing and the `Add Exercise` title ship, but
  the builder and live destinations are Phase 3.
- **Instructions are shown on the detail screen**, which the prototype has no field for — the
  ingested dataset provides them, and an exercise detail with no instructions would be thinner
  than the design intends.
- **Imagery is a stopgap.** free-exercise-db's photographic stills ship mirrored to our own
  storage; the design's own row draws a `dumb` glyph tile rather than a thumbnail, so the
  library list is unaffected either way. See ADR-018.

## 9. Train quick actions

Prototype `s_train()`, quick-action row at line 2434 — the only part of Train that Phase 2
builds:

```js
h('div',{key:'q',style:{display:'flex',gap:8,marginTop:16}}, [
  ['Start a run','run','runner'], ['Exercise library','library','dumb']
].map(...))
```

Each card: `flex: 1`, `min-width: 0`, background `CARD`, `BRD`, radius 13, padding `11px 13px`,
`flex` row, `align-items: center`, `gap: 9`, hover `border-color: rgba(233,113,47,.4)`.
Icon `flex: none`, at `#8b8b83`, size 18. Label `600 12.5px/1.15 Archivo`, colour `W`,
`min-width: 0`, `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`.

`Start a run` targets a Phase 3 screen — render the card, route it nowhere yet.

## 10. Reference: the prototype's helper logic worth porting

`toolsOf(name)` (line 1463) and `measureOf(name)` (line 1477) are the prototype's stand-ins for
data it did not have: both fall back to a regex/lookup over the exercise **name** when the row
carries no explicit value. Phase 2 replaces both with real columns populated by the ingest
adapter — the regexes are not worth porting, but they are worth reading, because they encode the
design's intent about which exercises are time-measured
(`Plank`, `Hollow Hold`, `Sun Salutation A`, `Warrior Flow`, `90/90 Hip Switch`,
`Thoracic Opener`, `Tempo Intervals`, `Dead Hang`, `Wall Sit`, `Side Plank`) and which are
distance-measured (`5K Run`, `Row Machine`, `Assault Bike`, `Ski Erg`). Use that as the
acceptance check on the adapter's derived `measure`.
