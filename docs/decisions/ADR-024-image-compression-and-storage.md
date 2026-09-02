# ADR-024: Image compression pipeline for uploaded media

**Status:** Accepted
**Date:** 2026-09-02

Supplements ADR-018 (exercise media hosting) and ADR-019 (username and avatar), which both
established *where* uploaded images live (Supabase Storage, via `StorageProvider`, a storage
key held in the database rather than a URL). This ADR covers a question neither answered:
*how big are the bytes we actually store*, and who is responsible for making them small.

## Context

Checking `AvatarUploadService` (ADR-019's shipped implementation) found it does **no
compression at all**. It accepts any file up to 5 MiB, of an allowed MIME type, and uploads
the raw bytes unchanged. A phone camera photo picked as an avatar — routinely several MB at
4000×3000 or larger — is stored and served at that size, to be displayed at a few dozen
pixels across the app (profile header, athlete cards, future leaderboard rows). This is a
real, already-shipped gap, not a hypothetical one, surfaced while planning image handling for
a new feature (the nutrition share-card's background-photo picker) and generalized to every
image upload in the app on request.

The share-card background photo is a different problem and explicitly out of this ADR's
scope: it is gallery-only (confirmed directly — the exported card is saved to the phone's own
photo library via `expo-image-picker`'s existing save flow, never uploaded to our backend), so
it has no storage or bandwidth cost to us at all. It still needs a lightweight **on-device**
downsize before compositing, purely so a full-resolution camera photo doesn't blow up memory
while rendering the card locally — a display-time concern, not a storage one, and not what
"compression" means for the rest of this document.

## Decision

**A two-stage pipeline for every image that is actually uploaded to our storage: client-side
pre-resize, then a mandatory server-side canonical re-encode.**

1. **Client-side pre-resize**, via `expo-image-manipulator` (new dependency, standard Expo
   SDK package, compatible with the pinned SDK 54 per `apps/mobile/AGENTS.md`). Resizes and
   re-encodes the image *before* the upload request is even made. This is a UX and bandwidth
   optimization only, not a correctness guarantee — it makes uploads fast on a phone
   connection (a multi-MB photo becomes a couple hundred KB before it ever leaves the device),
   nothing more.
2. **Server-side canonical re-encode**, via `sharp` (new dependency, the standard Node image
   library; runs fine on Cloud Run, no native-binary concerns beyond the existing Docker
   build). This is the correctness guarantee: **the server never trusts client-side
   compression**, because a stale app build, a buggy client, or a hand-crafted request could
   skip it entirely. Every uploaded image is re-processed server-side into one guaranteed
   final shape — fixed max dimensions, fixed format, fixed quality — before it is written to
   storage. The stored bytes are always the server's own output, never a passthrough of
   whatever the client sent.

**Format: WebP.** Meaningfully smaller than JPEG at equivalent visual quality, and
`expo-image` (already the image component used throughout this app, per Phase F's own notes
on its caching behavior) supports it natively on both platforms — no new client capability
required to display what this ADR produces.

**Per-asset-type targets** (avatar is the only shipped consumer today; future uploads such as
InBody scan photos get their own row in this table when that phase is built, following the
same two-stage pipeline rather than re-deciding it):

| Asset | Max dimension | Quality | Rationale |
|---|---|---|---|
| Avatar | 512×512 | 80 | Never rendered larger than a few dozen px anywhere in the current design (profile header, athlete cards, future leaderboard rows); 512px is generous headroom for retina displays without storing invisible resolution. Quality 80 is WebP's standard sweet spot — no visible artifacting at the sizes this is actually displayed. |

## Alternatives rejected

**Server-side only, no client pre-resize.** Would still guarantee correct final bytes, but
every upload pays the cost of transmitting a multi-MB original first — a real UX cost on a
phone connection this app has no reason to accept when a client-side pass is cheap and
standard.

**Client-side only, trust the client.** Rejected outright — an uploaded asset's final bytes
must never depend on trusting client behavior, the same reasoning CLAUDE.md rule 12 applies to
authorization ("RLS is defense-in-depth... a rule that exists only in SQL is a rule you can't
unit test"). A compression rule enforced only on the client is a rule an attacker, a stale
build, or a bug can simply not apply.

**A third-party image CDN/transformation service** (Cloudinary, imgix, etc.). Rejected on the
same free-tier grounds ADR-018 already used to reject anything beyond Supabase Storage: it
adds a paid dependency and an external account for a problem `sharp` solves entirely within
the existing Cloud Run container, at zero additional infrastructure cost.

## Consequences

- `AvatarUploadService` (ADR-019, already shipped) is retrofitted with the `sharp` re-encode
  step — this is a fix to already-shipped behavior, not new-feature scope creep, since the gap
  it closes was real and already in production.
- `edit-profile.tsx` and `pick-username.tsx` (both already using `expo-image-picker` for
  avatar selection) gain the client-side pre-resize step via a new shared utility, rather than
  each screen reimplementing it — the same "no adjacent feature, no premature abstraction, but
  real duplication gets extracted" principle CLAUDE.md's coding-style rules already state.
- **Free-tier math improves, not worsens.** Avatars compressed this way land around 20–80 KB
  each instead of up to 5 MiB uncompressed — comfortably inside the same ~1 GB storage /
  ~5 GB egress Supabase free-tier ceiling ADR-018 measured against for exercise media, with far
  more headroom than the uncompressed path left.
- **Existing already-uploaded avatars are not retroactively recompressed by this ADR.** A
  backfill job re-processing every stored avatar through the new pipeline is real, separate
  work (bounded scope: iterate `avatars` bucket objects, re-encode, replace) — worth doing
  once real users exist with real avatars, not before. Flagged here so it is not silently
  forgotten, not treated as in-scope for this decision's initial implementation.
- **Two new dependencies**: `sharp` (`apps/api`) and `expo-image-manipulator` (`apps/mobile`).
  Both are the standard, widely-used choice for their respective runtime — not a
  build-something-custom decision.
