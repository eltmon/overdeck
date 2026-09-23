/**
 * The browser-UAT verdict marker (#4036).
 *
 * `pan admin specialists done` ends a UAT verdict comment with this marker;
 * `pr-facts` reads it back so merge readiness can tell a failure at the current
 * PR head from one a later push superseded. Pure: no IO, no imports.
 */

/**
 * The marker: the outcome and the commit UAT exercised (`--tested-sha`, else
 * the PR head when the verdict was posted).
 */
export function formatUatMarker(status: 'passed' | 'failed', sha?: string | null): string {
  return `<!-- overdeck-uat: ${status}${sha ? ` sha=${sha.toLowerCase()}` : ''} -->`;
}

const UAT_MARKER_RE = /<!--\s*overdeck-uat:\s*(passed|failed)(?:\s+sha=([0-9a-f]{7,40}))?\s*-->/i;
/** A verdict comment posted before the marker existed: `**uat verdict: failed**` / `**browser UAT: failed**`. */
const LEGACY_UAT_RE = /\*\*(?:uat verdict|browser UAT):\s*(passed|failed)\*\*/i;

/** The UAT outcome (and the commit it is anchored on) a comment body declares, or null. */
export function parseUatVerdict(
  body: string | null | undefined,
): { status: 'passed' | 'failed'; sha: string | null } | null {
  if (!body) return null;
  const marker = body.match(UAT_MARKER_RE);
  if (marker) {
    return { status: marker[1].toLowerCase() as 'passed' | 'failed', sha: marker[2]?.toLowerCase() ?? null };
  }
  const legacy = body.match(LEGACY_UAT_RE);
  return legacy ? { status: legacy[1].toLowerCase() as 'passed' | 'failed', sha: null } : null;
}
