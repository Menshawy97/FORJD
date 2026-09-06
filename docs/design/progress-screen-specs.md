# Progress screen specs — extracted from the prototype

**Source:** `FORJD mobile app design/FORJD Mobile.dc.html`, the runnable prototype, which
outranks every summary including this file. Where this doc and the prototype disagree, the
prototype is right. Screenshots (`FORJD mobile app design/screenshots/progress strength*.png`)
outrank the prototype where the two differ, per the project's standing precedence order.

**Scope:** the Progress tab's **Strength** view only, built in Phase 4. Body and Health
(Phase 5, Phase 6) are recorded here for completeness but not built yet.

---

## 0. Build-readiness

| Section | Backend needed | Buildable today |
|---|---|---|
| PR tiles | `GET /workouts/sessions/progress/strength` | yes |
| Estimated 1RM trend | same | yes |
| Weekly volume | same | yes |
| Training calendar | same | yes |
| Muscle group split | same | yes |
| Avg step count | Health Connect / HealthKit (Phase 6) | honest-empty only |
| FORJD Insight | same endpoint, rules-based (`@forjd/domain`) | yes |
| Body tab | InBody scan (Phase 5) | honest-empty only |
| Health tab | Health Connect / HealthKit (Phase 6) | honest-empty only |

---

## 1. Shared chrome

Template block: `FORJD Mobile.dc.html:288-503`.

**Outer column:** `flex:1;min-height:0;display:flex;flex-direction:column;position:relative`.

**Page title** (line 290): `padding:2px 22px 12px`, `h1` at
`font:700 26px/1.15 Archivo;letter-spacing:-.02em;color:#f6f5f3`, no back button, no
right-hand accessory.

**Segmented control** (lines 291-297, `segStyle()` at 3298): track
`padding:0 22px 14px` outer, inner track `gap:4;padding:4;background:#141416;
border:1px solid rgba(255,255,255,.07);border-radius:12`; each segment
`flex:1;height:38;borderRadius:9;font:'600 13px/1 Archivo'`; active
`background:#232326;color:#f6f5f3;boxShadow:0 1px 3px rgba(0,0,0,.4)`; inactive
`background:transparent;color:#7e7e77`, no shadow. Tabs: `Strength`, `Body`, `Health`.

**Scroll body:** `flex:1;min-height:0;overflow-y:auto;padding:0 22px 26px`. Tab bodies animate
`fj-fade .25s` in the prototype (not implemented as an animation in the RN build — a fade-in
is not load-bearing to the design and was left out rather than added as an unrequested extra).

**Tabbar:** the real bottom tab bar from `(tabs)/_layout.tsx`, not a screen-drawn one.

---

## 2. Strength cards, in design order

### PR tiles (`progress strength.png`)

Two tiles side by side, `gap:10`. Each: `background:#17181a;border:1px solid
rgba(255,255,255,.07);border-radius:14;padding:13px 14px`. Heading `9.5px/1 600 Archivo,
letter-spacing .14em, uppercase, #77776f`. Value row: `700 25px/1 Archivo, letter-spacing
-.02em, #f6f5f3, tabular-nums` plus a `500 11.5px/1 #6e6e66` unit. Delta line
`500 11px/1 #79b98a` (or a negative-delta colour, not shown in the design since the demo data
has no negative example).

**Built decision:** the design's literal "Bench PR" / "Squat PR" are replaced with the
athlete's two most recently achieved records, each tile headed by its own exercise name
(`"<Exercise> PR"`). See `phase-4-plan.md`'s locked decisions for the reasoning.

### Estimated 1RM — 8 weeks (`progress strength.png`)

Card heading `Estimated 1RM — 8 weeks`. `sparkline(pts, O, 300, 86, true)` — see
`sparkline()`'s full geometry below. Week labels `W2`..`W8` in the prototype's demo data; the
real build has no week-index labels (the eight demo labels assume a fixed 8-week window
starting at a specific week, which the real data does not).

### Weekly volume (kg) (`progress strength.png`)

Bars: `flex; alignItems:flex-end; gap:9; height:92`. Each column
`flex:1;flexDirection:column;justifyContent:flex-end;alignItems:center;gap:8;height:100%`.
Bar: `width:82%;borderRadius:5;background:#e9712f` (trained) or `#232427` at 2px height
(rest). Day labels `Mon`..`Sun`, `500 10px/1 #5c5c55`.

### Training calendar (`progress strength.png`)

See `calVals()` — training-calendar.tsx's own docblock carries the full transcription
(cell sizing, colours, today's ring, the legend's own colour mismatch against the rest cell).

### Muscle group split (`progress strength 2.png`)

See `muscleVals()` — muscle-split.tsx's own docblock carries the transcription.

### Avg step count (`progress strength 2.png`)

Card heading `Avg step count`. Day/Week/Month `miniSegStyle()` control (see
`segmented-control.tsx`), a big number + `steps` unit, then a sparkline. **Built honestly
empty** (Phase 6) — see `step-count-card.tsx`.

### FORJD Insight (`progress strength 3.png`)

Card border `rgba(233,113,47,.2)` (distinct from the other cards' neutral border). Heading
`FORJD Insight` in accent colour, **not "AI insight"** — see ADR-030. Body
`500 13px/1.5 #e4e2de` with a bold lead clause.

---

## 3. `sparkline()` — full geometry (`FORJD Mobile.dc.html:1556`)

```js
sparkline(pts,color,w,hh,fill){
  const max=Math.max(...pts),min=Math.min(...pts),rng=(max-min)||1;
  const d=pts.map((p,i)=>(i?'L':'M')+(i*(w/(pts.length-1))).toFixed(1)+' '+(hh-((p-min)/rng)*(hh-8)-4).toFixed(1)).join(' ');
  return svg(w,hh,[fill-path,line-path]);
}
```

`preserveAspectRatio="none"`, fill closes to baseline at `fillOpacity:.1`, line
`strokeWidth:1.8, strokeLinecap:round`, **no `strokeLinejoin`**, **no tip dot**. Flat series
(`rng` would be 0) draws a flat line via `|| 1` rather than `NaN`. A single point draws
nothing. Transcribed in `components/sparkline.tsx`; Progress passes `height={86}` and
`color="#E9712F"` for the 1RM trend, `color="#8FB4C9"` for steps (not yet used, honest-empty).

---

## 4. Screenshots consulted

`progress strength.png`, `progress strength 2.png`, `progress strength 3.png` — all present
under `FORJD mobile app design/screenshots/`. Not built in this phase, recorded for later:
`progress body 1-3.png`, `progress health 1-2.png`, `progress body change widget.png`,
`progress health change widget.png` (Body/Health tabs, Phase 5/6). **Not part of Progress at
all**, despite being adjacent in the prototype: `your week1.png` / `your week2.png` (`s_weekly`,
a route pushed from Home, not a Progress tab).

## 5. Related

- [`../product/phase-4-plan.md`](../product/phase-4-plan.md) — the build plan and locked
  decisions this doc supports.
- [`../decisions/ADR-029-progress-analytics-computed-on-read.md`](../decisions/ADR-029-progress-analytics-computed-on-read.md)
- [`../decisions/ADR-030-forjd-insight-rules-based-not-ai.md`](../decisions/ADR-030-forjd-insight-rules-based-not-ai.md)
