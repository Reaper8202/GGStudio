// Mapping from the source pack's generically-numbered SVGs to descriptive
// names, derived by rasterizing every "Icon (N).svg" and every named
// "<Name>.png" in the companion PNG export at matching resolution and
// pairing each SVG with its nearest-shape PNG (alpha-channel diff), then
// manually verifying the ambiguous/high-diff pairs against side-by-side
// renders (Shop=cart, Movie=clapperboard, Mixer=sliders, etc.).
//
// Icon (5).svg is a stray empty/invisible path (fill:none, no stroke) and
// Icon (8).svg is actually a full preview sheet containing dozens of icons
// composited into one file (not a usable individual glyph) - both are
// intentionally excluded from the shipped set. Icon (20).svg and
// Icon (46).svg are unlabeled spare shapes with no PNG counterpart in the
// source pack and are also excluded (nothing in CONTRACTS.md/plan needs them).
export const ICON_NAME_BY_SVG = {
  'Icon (1).svg': 'Pause',
  'Icon (2).svg': 'Phone',
  'Icon (3).svg': 'Minus',
  'Icon (4).svg': 'VolumeOn',
  'Icon (9).svg': 'ZoomIn',
  'Icon (10).svg': 'ZoomOut',
  'Icon (11).svg': 'Group',
  'Icon (12).svg': 'Zoom',
  'Icon (13).svg': 'Target',
  'Icon (14).svg': 'Settings',
  'Icon (15).svg': 'Power',
  'Icon (16).svg': 'Smile',
  'Icon (17).svg': 'Dislike',
  'Icon (18).svg': 'Like',
  'Icon (19).svg': 'Trash',
  'Icon (21).svg': 'Laptop',
  'Icon (22).svg': 'Gift',
  'Icon (23).svg': 'Mixer',
  'Icon (24).svg': 'Moon',
  'Icon (25).svg': 'Sun',
  'Icon (26).svg': 'Bookmark',
  'Icon (27).svg': 'Heart',
  'Icon (28).svg': 'Warning2',
  'Icon (29).svg': 'Warning1',
  'Icon (30).svg': 'Disket',
  'Icon (31).svg': 'Home2',
  'Icon (32).svg': 'Circle',
  'Icon (33).svg': 'Stop',
  'Icon (34).svg': 'Shop',
  'Icon (35).svg': 'Movie',
  'Icon (36).svg': 'Podium',
  'Icon (37).svg': 'Alert',
  'Icon (38).svg': 'Info',
  'Icon (39).svg': 'User',
  'Icon (40).svg': 'Unlocked',
  'Icon (41).svg': 'Locked',
  'Icon (42).svg': 'Left',
  'Icon (43).svg': 'Up',
  'Icon (44).svg': 'Right',
  'Icon (45).svg': 'Down',
  'Icon (47).svg': 'Plus',
  'Icon (48).svg': 'Medal',
  'Icon (49).svg': 'Home',
  'Icon (50).svg': 'VolumeOff',
  'Icon (52).svg': 'Tab',
  'Icon (53).svg': 'Correct',
  'Icon (54).svg': 'Wrong',
  'Icon (55).svg': 'Play',
};

// CursorIcons/MouseIcon (N).svg -> name, determined by visual inspection
// (rasterized grid) since the source files carry no descriptive names.
export const CURSOR_NAME_BY_SVG = {
  'MouseIcon (1).svg': 'ResizeDiagonal',
  'MouseIcon (2).svg': 'ResizeEW',
  'MouseIcon (3).svg': 'ResizeNS',
  'MouseIcon (4).svg': 'No',
  'MouseIcon (5).svg': 'Hand',
  'MouseIcon (6).svg': 'Move',
  'MouseIcon (7).svg': 'Text',
  'MouseIcon (8).svg': 'Loading',
  'MouseIcon (9).svg': 'ArrowOutline',
  'MouseIcon (10).svg': 'Arrow',
};
