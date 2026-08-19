# Spike B — InBody extraction accuracy

Timeboxed (6 hours) measurement of whether Claude vision can read InBody report
photos accurately enough for Phase 5 to be built on it. Produces the accuracy
table and the confidence/error finding that `docs/decisions/ADR-006-inbody-extraction.md`
needs before it can move from Proposed to Accepted.

These scripts are throwaway. No application code imports them, and this directory
is deliberately outside the pnpm workspace.

## Where the photos go

```
scripts/spikes/inbody-samples/
├── photos/     ← put your InBody photos here (.jpg .jpeg .png .webp)
├── truth/      ← you hand-label these, one per photo
└── out/        ← extraction results (created automatically)
```

`inbody-samples/` is gitignored — **real InBody sheets are personal health data
and must never be committed.** Only anonymized golden fixtures reach the repo, in
`tests/fixtures/inbody/`, once this spike concludes.

Collect **10-15 photos**, deliberately varied: different InBody models (270/570/770),
good and bad lighting, straight-on and angled, glare, and partial crops. A clean
sample set proves nothing — the failures are the point.

## Running it

```bash
cd scripts/spikes
pnpm install --ignore-workspace
```

The flag is required: this directory is intentionally not a member of the root
pnpm workspace, and without it pnpm looks at the workspace and reports
"No projects found".

Set your Anthropic API key (the SDK reads it from the environment):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Extract:

```bash
pnpm extract
```

This writes one `out/<photo-name>.json` per photo, with a value, a confidence, and
a reading note for each of the six fields.

## Hand-labelling ground truth

For each photo, read the sheet yourself and write `truth/<photo-name>.json` with the
**same filename stem** as the photo. Bare numbers, no confidence:

```json
{
  "fields": {
    "weight_kg": 84.6,
    "body_fat_percent": 18.2,
    "skeletal_muscle_mass_kg": 38.1,
    "bmi": 26.4,
    "visceral_fat_level": 8,
    "total_body_water_l": 45.3
  }
}
```

Use `null` for any field that sheet doesn't print. Label from the photo, not from
the extraction output — reading the model's answer first will bias you into
confirming its mistakes.

## Scoring

```bash
pnpm score
```

Reports per-field accuracy (never document-level — one wrong number corrupts a
progress graph permanently while the other five look fine), accuracy bucketed by
confidence, and the count that actually decides the ADR: **high-confidence errors**,
the readings a pre-filled confirmation screen would invite a user to tap straight
past.

The kill criterion is in ADR-006: if confidence doesn't correlate with real errors,
the confidence gate is decorative and needs redesigning before Phase 5 depends on it.
