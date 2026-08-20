/// SVG path data for the FORJD icon set, transcribed from the design.
///
/// The design draws every icon as thin strokes on a 24x24 canvas, so these are stroke
/// outlines, not filled shapes — [kForjdIconViewBox] is the canvas they are authored
/// against and ForjdIcon scales from it.
///
/// The design expresses some shapes as `<rect>` and `<circle>` elements rather than paths.
/// Those are written out as equivalent path data here (rounded rects as arc corners,
/// circles as two half arcs) so the whole set is one uniform, parseable format.
library;

const kForjdIconViewBox = 24.0;

/// Icon name to its path data. Several icons are two or more subpaths; they are drawn in
/// order into a single path.
const kForjdIconPaths = <String, List<String>>{
  // Tab bar.
  'home': ['M4 10.6 12 4.4l8 6.2V20h-5.4v-5.2H9.4V20H4z'],
  'train': [
    'M3.2 9h1.2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
    'M19.6 9h1.2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
    'M5.4 12h13.2',
  ],
  'progress': ['M3.5 16.5 9 10.8l3.6 3.4 7.4-7.2', 'M15.2 6.8H20v4.6'],
  'rank': ['M7.4 4.6h9.2v3.6a4.6 4.6 0 0 1-9.2 0z', 'M12 12.8v3.4M8.4 19.4h7.2'],
  'profile': [
    'M8.7 8a3.3 3.3 0 1 0 6.6 0 3.3 3.3 0 1 0-6.6 0',
    'M5.4 19.6c0-3.7 3-5.6 6.6-5.6s6.6 1.9 6.6 5.6',
  ],

  // Welcome screen feature rows.
  'bolt': ['M13.4 3.6 6.8 13h4.2l-.6 7.4L17.4 11h-4.4z'],
  'heart': [
    'M12 19.6S4.4 15 4.4 9.8A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7.6 1.6c0 5.2-7.6 9.8-7.6 9.8z',
  ],
  'chart': ['M5 19V11M12 19V5M19 19v-6'],

  // Profile and settings rows.
  'bell': [
    'M7 10a5 5 0 0 1 10 0c0 4 1.4 5.4 1.4 5.4H5.6S7 14 7 10zM10.4 18.4a1.8 1.8 0 0 0 3.2 0',
  ],
  'target': [
    'M4.4 12a7.6 7.6 0 1 0 15.2 0 7.6 7.6 0 1 0-15.2 0',
    'M8.6 12a3.4 3.4 0 1 0 6.8 0 3.4 3.4 0 1 0-6.8 0',
  ],
  'link': [
    'M10 14 14 10',
    'M8.4 16.6a3.1 3.1 0 0 1-.2-4.4l2-2M15.8 7.4a3.1 3.1 0 0 1 .2 4.4l-2 2',
  ],
  'scale': ['M12 4.6v14.8M6 8.4h12M4.4 8.4 2.6 14h3.6zM19.6 8.4 17.8 14h3.6z'],
  'shield': ['M12 3.6 5.6 6v6c0 4 6.4 8.4 6.4 8.4s6.4-4.4 6.4-8.4V6z'],
  'pin': [
    'M12 21s6-6 6-10.4A6 6 0 0 0 6 10.6C6 15 12 21 12 21z',
    'M9.8 10.4a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0',
  ],
  'upload': ['M12 15.4V5.6M8.2 9.4 12 5.6l3.8 3.8', 'M5.4 15.8v2.6h13.2v-2.6'],
  'dumb': [
    'M3.8 9.4h1a.8.8 0 0 1 .8.8v3.6a.8.8 0 0 1-.8.8h-1a.8.8 0 0 1-.8-.8v-3.6a.8.8 0 0 1 .8-.8z',
    'M19.2 9.4h1a.8.8 0 0 1 .8.8v3.6a.8.8 0 0 1-.8.8h-1a.8.8 0 0 1-.8-.8v-3.6a.8.8 0 0 1 .8-.8z',
    'M5.6 12h12.8',
  ],
  'star': ['m12 4.6 2.3 4.9 5.1.7-3.7 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2L4.6 10.2l5.1-.7z'],
  'search': ['M5.4 11a5.6 5.6 0 1 0 11.2 0 5.6 5.6 0 1 0-11.2 0', 'm15.4 15.4 3.4 3.4'],
  'clock': ['M4.2 12a7.8 7.8 0 1 0 15.6 0 7.8 7.8 0 1 0-15.6 0', 'M12 7.6V12l3 2'],
  'plus': ['M12 5.6v12.8M5.6 12h12.8'],
  'check': ['m5.6 12.4 4 4 8.8-9'],
  'x': ['M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6'],

  // Trailing affordance on a list row.
  'chevron': ['m9.6 6.4 5 5.6-5 5.6'],

  // Back navigation. Mirrors `chevron` so the two stay visually identical.
  'chevronLeft': ['m14.4 6.4-5 5.6 5 5.6'],
};
