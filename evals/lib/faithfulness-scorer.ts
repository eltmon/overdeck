// E4 summary faithfulness: does a summary keep the planted facts and invent nothing?
// Hallucination = identifiers absent from the source + retracted decoys stated as current.
// Mechanical and reproducible; no LLM judge. Pure: no fs, no network.

export type SummaryKind = 'fork' | 'compaction' | 'handoff' | 'title';

export interface SummaryCase {
  id: string;
  kind: SummaryKind;
  /** Provenance: "real session excerpt, <project>, <yyyy-mm>, scrubbed" or "synthetic". */
  source: string;
  /** Claude Code JSONL entries (type 'user' / 'assistant', message.content), as serializeConversation accepts. */
  entries: unknown[];
  /** Handoff only. */
  focus?: string;
  /** A fact is recalled when every term of at least one alternative occurs (case-insensitive). */
  plantedFacts: Array<{ id: string; anyOf: string[][] }>;
  /** Anchor text that must not be asserted as current. */
  decoys: Array<{ id: string; anchor: string }>;
}

const KINDS: readonly SummaryKind[] = ['fork', 'compaction', 'handoff', 'title'];

export function parseSummaryCase(data: unknown): SummaryCase {
  const c = data as Partial<SummaryCase> | null;
  const label = c && typeof c.id === 'string' ? c.id : '(unknown)';
  const fail = (message: string): never => {
    throw new Error(`Invalid summary case ${label}: ${message}`);
  };
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || c.id === '') fail('missing id');
  if (!KINDS.includes(c!.kind as SummaryKind)) fail(`kind must be one of ${KINDS.join(', ')}`);
  if (typeof c!.source !== 'string' || c!.source === '') fail('missing source provenance');
  if (!Array.isArray(c!.entries) || c!.entries.length === 0) fail('entries must be a non-empty array');
  if (c!.kind === 'handoff' && (typeof c!.focus !== 'string' || c!.focus.trim() === '')) fail('a handoff case needs a focus');
  const facts = c!.plantedFacts;
  if (
    !Array.isArray(facts) ||
    facts.length === 0 ||
    !facts.every(
      (f) =>
        f &&
        typeof f.id === 'string' &&
        Array.isArray(f.anyOf) &&
        f.anyOf.length > 0 &&
        f.anyOf.every((alt) => Array.isArray(alt) && alt.length > 0 && alt.every((t) => typeof t === 'string' && t !== '')),
    )
  ) {
    fail('plantedFacts must be a non-empty array of { id, anyOf: string[][] }');
  }
  const decoys = c!.decoys;
  if (!Array.isArray(decoys) || !decoys.every((d) => d && typeof d.id === 'string' && typeof d.anchor === 'string' && d.anchor !== '')) {
    fail('decoys must be an array of { id, anchor }');
  }
  return c as SummaryCase;
}

const PATH_RE = /(?:~\/|\b)(?:[\w.@-]+\/)+[\w.@-]+\.(?:tsx?|js|md|json|sh|ya?ml)\b|\b[\w-]+\.(?:tsx?|md|json|sh|ya?ml)\b/g;
const ISSUE_ID_RE = /\b[A-Z]{2,}-\d+\b/g;
// Standards identifiers shaped like issue ids; never Overdeck-invented facts.
const NON_ISSUE_PREFIXES = new Set(['UTF', 'SHA', 'ISO', 'HTTP', 'TLS', 'SSL', 'RFC', 'ES']);
const HEX_RE = /\b[0-9a-f]{7,40}\b/g;
// Single-token spans only: a multi-word span is a command or quote a model may reformat, not an identifier.
const BACKTICK_RE = /`([^`\s]{3,})`/g;

/** Identifier-shaped tokens: paths, issue ids, git SHAs and `backticked` identifiers. */
export function extractIdentifiers(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PATH_RE)) found.add(m[0]);
  for (const m of text.matchAll(ISSUE_ID_RE)) {
    if (!NON_ISSUE_PREFIXES.has(m[0].split('-')[0]!)) found.add(m[0]);
  }
  for (const m of text.matchAll(HEX_RE)) {
    if (/[a-f]/.test(m[0]) && /\d/.test(m[0])) found.add(m[0]);
  }
  for (const m of text.matchAll(BACKTICK_RE)) found.add(m[1]!.trim());
  return [...found].filter((id) => id.length > 0);
}

/**
 * Extracted identifiers that do not occur anywhere in the source: a case-sensitive substring
 * match, except issue ids, which match case-insensitively (branches and paths spell PAN-12 as pan-12).
 */
export function unsupportedIdentifiers(summary: string, source: string): string[] {
  const lowerSource = source.toLowerCase();
  return extractIdentifiers(summary).filter((id) =>
    /^[A-Z]{2,}-\d+$/.test(id) ? !lowerSource.includes(id.toLowerCase()) : !source.includes(id),
  );
}

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+|\n+/;
const RETRACTION_RE =
  /\b(not|no longer|instead|rather than|rejected|abandoned|reverted|dropped|replaced|switched|changed|discarded|superseded|ruled out)\b/i;

export function splitSentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT_RE).filter((s) => s.trim() !== '');
}

/** Decoy ids whose anchor appears in a sentence that carries no retraction word. */
export function decoyViolations(summary: string, decoys: SummaryCase['decoys']): string[] {
  const sentences = splitSentences(summary);
  return decoys
    .filter((d) => {
      const anchor = d.anchor.toLowerCase();
      return sentences.some((s) => s.toLowerCase().includes(anchor) && !RETRACTION_RE.test(s));
    })
    .map((d) => d.id);
}

export function factRecalled(text: string, fact: SummaryCase['plantedFacts'][number]): boolean {
  const lower = text.toLowerCase();
  return fact.anyOf.some((alt) => alt.every((term) => lower.includes(term.toLowerCase())));
}

export function plantedRecall(summary: string, facts: SummaryCase['plantedFacts']): number {
  if (facts.length === 0) return 0;
  return facts.filter((f) => factRecalled(summary, f)).length / facts.length;
}

/** 3-8 words, no surrounding quotes, no trailing . ! ? : */
export function titleFormatValid(title: string): boolean {
  const t = title.trim();
  if (t === '' || /^["'`“‘]|["'`”’]$/.test(t) || /[.!?:]$/.test(t)) return false;
  const words = t.split(/\s+/).length;
  return words >= 3 && words <= 8;
}

/** JSON {"title": "..."} when parseable, else the first non-empty line. */
export function parseTitleOutput(text: string): string {
  const trimmed = text.trim();
  const candidates = [trimmed, trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1], trimmed.match(/\{[\s\S]*\}/)?.[0]];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as { title?: unknown };
      if (parsed && typeof parsed.title === 'string') return parsed.title.trim();
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return trimmed.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
}

export interface FaithfulnessScores {
  recall: number;
  unsupported: number;
  decoyHits: number;
  hallucinations: number;
  formatValid: 0 | 1 | null;
  score: number;
}

export function scoreFaithfulness(output: string, c: SummaryCase, serializedSource: string): FaithfulnessScores {
  const text = c.kind === 'title' ? parseTitleOutput(output) : output;
  const recall = plantedRecall(text, c.plantedFacts);
  const unsupported = unsupportedIdentifiers(text, serializedSource).length;
  const decoyHits = decoyViolations(text, c.decoys).length;
  const hallucinations = unsupported + decoyHits;

  if (c.kind === 'title') {
    const formatValid: 0 | 1 = titleFormatValid(text) ? 1 : 0;
    return { recall, unsupported, decoyHits, hallucinations, formatValid, score: formatValid ? recall / (1 + hallucinations) : 0 };
  }
  // handoff and compaction are hard-fail: a downstream agent acts on every stated fact.
  const score = c.kind === 'fork' ? recall / (1 + hallucinations) : hallucinations > 0 ? 0 : recall;
  return { recall, unsupported, decoyHits, hallucinations, formatValid: null, score };
}
