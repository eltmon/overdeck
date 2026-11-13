// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/office/sheet-sizing.ts @ 2d8a843e6b
// Excel's 255-character column width and 409.5-point row height, in the renderer's CSS pixels.
export const maximumTrackSize = { column: 255 * 7 + 5, row: (409.5 * 4) / 3 };
export const minimumTrackSize = 16;
