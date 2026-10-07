# ADR-065: Pushes go through an outbox that a drain sends, not from a timer or from the request

**Status:** Accepted (2026-10-07, with the 12F plan the owner approved 2026-10-06 and its answers).
**Date:** 2026-10-07
**Plan:** [phase-12f-plan.md](../product/phase-12f-plan.md). **Builds on:** [ADR-060](ADR-060-push-notification-transport.md)
(the transport), [ADR-061](ADR-061-what-a-notification-may-say.md) (what a push may say), [ADR-064](ADR-064-local-notifications-planned-and-rescheduled.md)
(the local notifications this does not replace).

## Context

12F sends two pushes from the server: a PR celebration right after a workout uploads, and a weekly leaderboard move. Three things
make "send it in the request" or "send it from a timer" wrong:

- **The snapshot runs at 00:20 UTC on Saturday**, which is 03:20 in Cairo, inside quiet hours. The owner decided (2026-10-06) that a
  push that would land in quiet hours is **moved to just after them, not dropped**. Something has to hold it until morning.
- **There is no scheduler in the API, and there must not be one.** Cloud Run scales to zero and runs several instances: an in-process
  timer would never fire, or would fire once per instance (the reason `leaderboard-snapshot.yml` is a GitHub Actions workflow).
- **A session upload comes from the offline queue and is retried.** It must never fail or slow down because of a push, and a retried
  upload must not send a second push.

## Decision

1. **Every push is a row in `push_outbox` before it is sent.** Senders (the PR sender at upload, the snapshot script) only write rows
   through `PushNotificationService.enqueue`. A unique `dedupe_key` (`pr:<sessionId>`, `rank:<weekStart>:<user>`) makes queueing
   idempotent: a retried upload queues one push.
2. **One dispatcher sends what is due**, claiming rows with `FOR UPDATE SKIP LOCKED` so two dispatchers (the workflow overlapping the
   immediate try after an upload) never both get one; a row `sending` for more than ten minutes (a dispatcher that died) is taken back.
3. **The send policy is a pure function in `@forjd/domain` (`decidePush`) and is taken twice**: when queueing, and again at the moment
   of sending, because the person may have changed a switch, their quiet hours or their phones in between. A push in quiet hours is
   given a `send_after` at the first minute after them in the person's own time zone; one that would be stale by then (PR 24 hours,
   rank 48 hours, judged at the time it would go) is dropped.
4. **A small workflow drains.** `push-drain.yml` (slice 6, the snapshot workflow's pattern; **every 3 hours on production only** because Actions minutes in a private repository are limited, so a held push can be up to 3 hours late; the first plan said every 15 minutes) calls
   `drain`: send what is due, read receipts about 15 minutes after sending (removing a phone the service says is gone), purge finished
   rows after 30 days. GitHub's cron is best effort and is disabled after 60 idle days; both are accepted. A PR push also tries an
   immediate send after the upload response has gone out, so the usual case does not wait for the workflow.
5. **Delivery is at-least-once, with backoff.** A push the service could not take is retried after 5, 10, 20 and 40 minutes, then marked
   `failed`. A refusal that will not change (message too big) fails at once. The adapter never retries a timeout (ADR-060's built note).
6. **The row is personal data.** It keeps the text (an exercise name, a city), so it is deleted with the account (cascade), is in the
   export, and finished rows are purged after 30 days. It never holds a health value (ADR-061); the data payload is a kind and an id.

### What at-least-once means here, exactly

- A push is claimed by one dispatcher, and the claim is **renewed for every row**, so a long batch is not mistaken for a dead dispatcher.
- Once the push service has accepted a push, nothing after it may put the row back: bookkeeping (tickets, marking sent) is best effort and logged, never a retry.
- A dispatcher that **dies between the send and marking the row sent** leaves it `sending`; it is taken back after ten minutes and sent again. Expo has no idempotency key, so this window cannot be closed, only kept small; a rare duplicate push is accepted over a lost one. Each take-back counts as a try, so a row that keeps killing its dispatcher ends up `failed`.
- With several phones, a push the service accepted for one and refused (retryably) for another is `sent`: the refused phone does not get it. Accepted for a push that is news for a day.
- Sends are one request per row and the recipient is read per row. Fine at this size; batching sends across rows (Expo takes 100 messages per request) is the change to make if volume ever needs it.

## Alternatives considered

- **Send inside the upload request.** Couples the offline upload path to a third party, cannot hold a push for the morning, and a retried
  upload would send twice without the same dedupe key anyway.
- **`@nestjs/schedule` or an in-process timer.** Never fires on a scale-to-zero instance and fires per instance otherwise.
- **Cloud Tasks or Cloud Scheduler.** Fires on time, but is another GCP service to configure and pay attention to; the free-tier constraint
  and the existing workflow pattern make a drain workflow the smaller step. It stays an option behind the same `drain` entry point.

## Consequences

- A rank push that waits for 07:00 depends on the drain running after 07:00 local; a drain that is late sends it late, never twice.
- Two tables (`push_outbox`, `push_tickets`), additive migrations `0036` and later, listed in `data-inventory.md`.
- The senders (slices 5 and 6) are small: build content with the `@forjd/domain` builders, call `enqueue`, and for a PR try `dispatchDue`.
