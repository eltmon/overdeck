/**
 * The browser-UAT verdict marker (#4036).
 *
 * `pan admin specialists done` ends a UAT verdict comment with this marker;
 * `pr-facts` reads it back, from trusted authors only, so merge readiness can
 * tell a failure at the current PR head from one a later push superseded.
 * Pure: no IO, no imports.
 */

/**
 * The marker: the outcome and the commit UAT exercised (`--tested-sha`, else
 * the PR head when the verdict was posted).
 */
export function formatUatMarker(status: 'passed' | 'failed', sha?: string | null): string {
  return `<!-- overdeck-uat: ${status}${sha ? ` sha=${sha.toLowerCase()}` : ''} -->`;
}

/**
 * The marker on a line of its own. A quote-reply (`> <!-- … -->`) or prose
 * around it does not count, and a comment without the marker declares nothing:
 * the bold `**browser UAT: failed**` text is for people, not for the gate.
 */
const UAT_MARKER_LINE_RE = /^[ \t]*<!--[ \t]*overdeck-uat:[ \t]*(passed|failed)(?:[ \t]+sha=([0-9a-f]{7,40}))?[ \t]*-->[ \t]*\r?$/im;

/** The UAT outcome (and the commit it is anchored on) a comment body declares, or null. */
export function parseUatVerdict(
  body: string | null | undefined,
): { status: 'passed' | 'failed'; sha: string | null } | null {
  const marker = body?.match(UAT_MARKER_LINE_RE);
  if (!marker) return null;
  return { status: marker[1].toLowerCase() as 'passed' | 'failed', sha: marker[2]?.toLowerCase() ?? null };
}
