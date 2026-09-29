/**
 * Plan critique gate (PAN-4341). Pure functions: parse a critique file, read
 * the PRD's `## Critique response` answers, and decide whether a flagged plan
 * may be promoted. Nothing here touches the filesystem, git or a tracker;
 * `plan-critique-io.ts` gathers the inputs and both `pan plan finalize` and
 * the complete-planning server call `evaluateCritiqueGate` with them.
 */

export const CRITIC_LABELS = ['architecture', 'substrate-improvement', 'security'] as const;
export const MAX_CRITIQUE_ROUNDS = 2;

export type FindingClass = 'blocks-the-design' | 'sharpens-framing' | 'footnote';

export interface CritiqueFinding {
  classification: FindingClass;
  title: string;
}

export interface ParsedCritique {
  /** Null when line 1 is not exactly `plan-digest: <64 lowercase hex>`. */
  digest: string | null;
  findings: CritiqueFinding[];
}

export interface CritiqueGateInput {
  required: boolean;
  currentDigest: string;
  /** Rounds used so far, 0..2 (tree or git history). */
  roundsUsed: number;
  latest: { round: 1 | 2; critique: ParsedCritique } | null;
  prdText: string | null;
}

export type CritiqueGateResult =
  | { ok: true; kind: 'not-required' | 'answered' }
  | { ok: true; kind: 'cap-reached'; unresolved: string[] }
  | { ok: false; kind: 'missing' | 'stale'; nextRound: 1 | 2; reason: string }
  | { ok: false; kind: 'unanswered'; titles: string[]; reason: string };

const DIGEST_LINE_RE = /^plan-digest: ([0-9a-f]{64})$/;
const FINDING_RE = /^## (blocks-the-design|sharpens-framing|footnote):\s*(.+?)\s*$/;
const RESPONSE_HEADING_RE = /^##\s+Critique response\s*$/i;
const LEVEL2_RE = /^## /;
const LEVEL3_RE = /^###\s+(.+?)\s*$/;
const UNRESOLVED_HEADING = '### Unresolved after two critic rounds';
const UNRESOLVED_HEADING_RE = /^###\s+Unresolved after two critic rounds\s*$/i;

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

export function parseCritique(text: string): ParsedCritique {
  const lines = text.split(/\r?\n/);
  const digestMatch = DIGEST_LINE_RE.exec(lines[0] ?? '');
  const findings: CritiqueFinding[] = [];
  for (const line of lines) {
    const match = FINDING_RE.exec(line);
    if (match) findings.push({ classification: match[1] as FindingClass, title: match[2]! });
  }
  return { digest: digestMatch ? digestMatch[1]! : null, findings };
}

/** Line range `[start, end)` of the `## Critique response` section, or null. */
function responseSection(lines: readonly string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => RESPONSE_HEADING_RE.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !LEVEL2_RE.test(lines[end]!)) end++;
  return { start, end };
}

/** Lower-cased, trimmed `###` titles under the PRD's `## Critique response` section. */
export function answeredCritiqueTitles(prdText: string): Set<string> {
  const lines = prdText.split(/\r?\n/);
  const section = responseSection(lines);
  const titles = new Set<string>();
  if (!section) return titles;
  for (let i = section.start + 1; i < section.end; i++) {
    const match = LEVEL3_RE.exec(lines[i]!);
    if (match && !lines[i]!.startsWith('####')) titles.add(normalizeTitle(match[1]!));
  }
  return titles;
}

export function isFlaggedByLabels(labels: readonly string[]): boolean {
  return labels.some((label) => (CRITIC_LABELS as readonly string[]).includes(label.trim().toLowerCase()));
}

function unansweredBlockingTitles(critique: ParsedCritique, prdText: string | null): string[] {
  const answered = prdText ? answeredCritiqueTitles(prdText) : new Set<string>();
  return critique.findings
    .filter((finding) => finding.classification === 'blocks-the-design' && !answered.has(normalizeTitle(finding.title)))
    .map((finding) => finding.title);
}

/** The FR-7 decision, evaluated in order (a)-(f). */
export function evaluateCritiqueGate(input: CritiqueGateInput): CritiqueGateResult {
  if (!input.required) return { ok: true, kind: 'not-required' };

  if (input.roundsUsed >= MAX_CRITIQUE_ROUNDS) {
    const unresolved = input.latest ? unansweredBlockingTitles(input.latest.critique, input.prdText) : [];
    return { ok: true, kind: 'cap-reached', unresolved };
  }

  const nextRound = (input.roundsUsed + 1) as 1 | 2;
  if (input.roundsUsed <= 0 || !input.latest) {
    return {
      ok: false,
      kind: 'missing',
      nextRound,
      reason: `no critique for round ${nextRound}; pan plan finalize dispatches the critic`,
    };
  }

  const { round, critique } = input.latest;
  if (critique.digest !== input.currentDigest) {
    const why = critique.digest === null ? 'has no valid "plan-digest:" first line' : 'was written for a different draft';
    return {
      ok: false,
      kind: 'stale',
      nextRound,
      reason: `the round ${round} critique ${why}; pan plan finalize dispatches round ${nextRound}`,
    };
  }

  const titles = unansweredBlockingTitles(critique, input.prdText);
  if (titles.length > 0) {
    return {
      ok: false,
      kind: 'unanswered',
      titles,
      reason: `answer each blocks-the-design finding with a "### <title>" heading under "## Critique response" in the PRD: ${titles.join('; ')}`,
    };
  }

  return { ok: true, kind: 'answered' };
}

/**
 * Write or replace the `### Unresolved after two critic rounds` subsection
 * under `## Critique response` (FR-14), creating the section when absent.
 * Idempotent: applying it twice with the same titles gives the same text.
 */
export function withUnresolvedSection(prdText: string, titles: readonly string[]): string {
  if (titles.length === 0) return prdText;
  const hasSection = prdText.split('\n').some((line) => RESPONSE_HEADING_RE.test(line));
  const text = hasSection ? prdText : `${prdText.trimEnd()}\n\n## Critique response\n`;
  const lines = text.split('\n');
  const section = responseSection(lines)!;
  const block = [UNRESOLVED_HEADING, '', ...titles.map((title) => `- ${title}`)];

  let subStart = -1;
  for (let i = section.start + 1; i < section.end; i++) {
    if (UNRESOLVED_HEADING_RE.test(lines[i]!)) {
      subStart = i;
      break;
    }
  }

  if (subStart >= 0) {
    let subEnd = subStart + 1;
    while (subEnd < section.end && !/^#{2,3}\s/.test(lines[subEnd]!)) subEnd++;
    while (subEnd - 1 > subStart && lines[subEnd - 1]!.trim() === '') subEnd--;
    lines.splice(subStart, subEnd - subStart, ...block);
    return lines.join('\n');
  }

  let insertAt = section.end;
  while (insertAt - 1 > section.start && lines[insertAt - 1]!.trim() === '') insertAt--;
  const inserted = ['', ...block];
  if (insertAt < lines.length && lines[insertAt]!.trim() !== '') inserted.push('');
  lines.splice(insertAt, 0, ...inserted);
  return lines.join('\n');
}
