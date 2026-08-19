# Product vision

## The one clear answer

A single place that unifies all of a person's health and training data —
InBody body composition, wearable/health-platform data, and a full exercise
library with real tracking — plus AI features on top, instead of three
separate apps. Every product and architectural decision is checked against
whether it serves *that*, not against feature-parity with any one competitor.

## Four questions the app answers

- **What should I do?** Workout/program recommendation, backed by an exercise
  database bigger than what a single-purpose training app would build.
- **How did I perform?** Workout and exercise analytics.
- **How is my body doing?** Health, recovery, sleep, cardiovascular, and
  body-composition trends, using InBody data as the body-composition anchor.
- **Am I actually improving?** Longitudinal analysis across all of the above
  — body composition, training commitment, health metrics — over weeks,
  months, and years.

## Audience

Serious, data-driven fitness people who already track their training and
want their health/recovery/body-composition data unified instead of spread
across three apps. The tone is precise and capable — a serious tool, not a
gamified consumer app.

## Architecture as product strategy

The differentiation is structural, not cosmetic: a canonical data model that
every external provider adapts into (see `docs/architecture/system.md`)
means the product's actual moat — unified, longitudinal, cross-source
insight — gets stronger with every provider added, while competitors
building around one data source stay siloed. See `docs/architecture/system.md`
for how this is enforced in code, not just claimed in a pitch.
