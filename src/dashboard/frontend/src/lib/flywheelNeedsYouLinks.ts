/**
 * Splits one flywheel needs-you item into text, issue-ID and PR segments
 * (PAN-5198). A PR links only when its repository is known: `owner/repo#n`
 * names it, or an in-flight row carries that PR number. A bare `#n` from
 * another repository stays text, because a guessed repo opens the wrong PR.
 * A qualified ref may carry a leading `PR ` (PAN-5239 FR-4); the link text
 * then includes it.
 */
import type { FlywheelInFlightRow } from '@overdeck/contracts';

export type NeedsYouSegment =
  | { kind: 'text'; text: string }
  | { kind: 'issue'; text: string; issueId: string }
  | { kind: 'pr'; text: string; url: string };

// Order matters: a qualified ref must win over its bare `#n` tail.
const REF_RE = /(?:\bPR )?\b([A-Za-z0-9][\w.-]*\/[\w.-]+)#(\d+)\b|\bPR #(\d+)\b|(?<![\w/#])#(\d+)\b|\b([A-Z]{2,}-\d+)\b/g;

export function needsYouSegments(text: string, inFlight: readonly FlywheelInFlightRow[]): NeedsYouSegment[] {
  const segments: NeedsYouSegment[] = [];
  let lastIndex = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const prev = segments[segments.length - 1];
    if (prev?.kind === 'text') {
      prev.text += value;
    } else {
      segments.push({ kind: 'text', text: value });
    }
  };

  for (const match of text.matchAll(REF_RE)) {
    pushText(text.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;

    const [full, qualifiedRepo, qualifiedNum, prNum, bareNum, issueId] = match;
    if (qualifiedRepo && qualifiedNum) {
      segments.push({ kind: 'pr', text: full, url: `https://github.com/${qualifiedRepo}/pull/${qualifiedNum}` });
      continue;
    }
    const n = prNum ?? bareNum;
    if (n !== undefined) {
      const row = inFlight.find((r) => r.pr?.number === Number(n));
      if (row?.pr) {
        segments.push({ kind: 'pr', text: full, url: row.pr.url });
      } else {
        pushText(full);
      }
      continue;
    }
    if (issueId) {
      segments.push({ kind: 'issue', text: full, issueId });
    }
  }
  pushText(text.slice(lastIndex));

  return segments.length ? segments : [{ kind: 'text', text }];
}
