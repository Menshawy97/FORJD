# ADR-052: The FORJD brand identity (symbol, wordmark, animations)

**Status:** Accepted
**Date:** 2026-09-24

## Context

Until now the logo was a four-bar "chart" glyph beside the word FORJD set in Archivo 800, taken
from the mobile design (`FORJD mobile app design/`). The user commissioned a proper identity and
approved it in the Design canvas "FORJD Logo" (https://claude.ai/artifact/23Cj4sYhRb3mShCr9Upuip):
a geometric F-and-J symbol, a custom-drawn wordmark, a four-colour palette and nine logo
animations. It is to be used for both the app and the website.

## Decision

1. **The canvas is the source of truth for the logo**, replacing the mobile design folder for that
   one thing (ADR-051 point 3 still holds for colour and type elsewhere). The symbol and wordmark
   are drawn paths, not type, so neither depends on a font being loaded:
   - Symbol, viewBox `0 0 100 100`, ember `#E9712F`.
   - Wordmark, viewBox `0 0 544 100`, Bone `#EDEBE6` on dark and Ink `#101011` on light.
   - Palette: Ink `#101011`, Graphite `#1B1B1D`, Bone `#EDEBE6`, Ember `#E9712F`.
   The two-tone "third bar" (`#A84D1D`) belonged to the old glyph and no longer marks the logo.
2. **Three of the nine animations ship, each in one role:**
   - **#4 Reveal** on the website header's brand link. It plays once when someone arrives from
     outside the site or reloads, and not when they move between the site's own pages. The
     tagline is left out of the header.
   - **#3 Pulse loader** for the app's longer waits (a screen's data, an InBody result being
     read). Small spinners inside buttons and cards stay as they are, because the symbol is not
     legible at 18 px.
   - **#9 Readiness ring** as a new in-app intro on every cold start, before Welcome or Home. It is
     cut to about 3.3 s: the design's timings up to the wordmark landing, then a short fade.
   All three honour the platform's reduce-motion setting.
3. **App icon and website favicon use the DARK tile**: Graphite `#1B1B1D` with the ember symbol,
   chosen by the user over the ember tile.

## Consequences

- Logo assets (icons, favicons, apple-touch-icon) are rendered from SVG by committed scripts
  (`apps/web/scripts/make-icons.mjs`, `apps/mobile/scripts/make-icons.mjs`), so a change to the
  mark is a script run, not hand-exported PNGs.
- The intro is an overlay above the router, not a route, so it cannot change where the app sends a
  user; auth routing stays in `_layout.tsx`'s gates.
- The icon and native splash change only reaches phones with the next native build.
