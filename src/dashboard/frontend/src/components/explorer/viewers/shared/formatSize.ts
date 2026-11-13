// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: packages/client-runtime/src/state/attachments.ts @ 2d8a843e6b
/** A file size as the binary card prints it: whole KB below 1 MB, one decimal MB above. */
export function formatSize(sizeBytes: number): string {
  const kilobytes = Math.max(1, Math.ceil(sizeBytes / 1024));
  // Pick the unit after rounding, so 1023.5 KB reads "1.0 MB", not "1024 KB".
  return kilobytes >= 1024 ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` : `${kilobytes} KB`;
}
