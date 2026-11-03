/**
 * Short-code parsing shared by the dashboard routes and the `pan share` / `pan join` CLI
 * (PRD PAN-4480 D-10). Imports nothing, so the CLI can load it without the HTTP router.
 */
export const SHORT_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
const MAX_TARGET_LENGTH = 2_048;

/** Uppercases and strips spaces and dashes like the share service; null unless 8 alphabet symbols remain. */
export function normalizeShareCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]+/g, '');
  if (code.length !== 8) return null;
  for (const ch of code) if (!SHORT_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** A short code, or a join URL whose path ends in `/s/<code>`; null unless it normalizes. */
export function parseJoinTarget(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_TARGET_LENGTH) return null;
  let candidate = raw.trim();
  try {
    const match = /\/s\/([^/]+)\/?$/.exec(new URL(candidate).pathname);
    if (match?.[1]) candidate = decodeURIComponent(match[1]);
  } catch {
    // Not a URL: treat it as a code.
  }
  return normalizeShareCode(candidate);
}

/** `BCDFGHJK` → `BCDF-GHJK`; any other length is returned unchanged. */
export function formatShareCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
