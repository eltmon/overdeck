// E2 review recall: does a review lane's report contain a blocking finding that matches
// the known blocker a real review convoy raised on the same diff? Pure: no fs, no network.

export type ReviewLane = 'correctness' | 'performance' | 'requirements';

export interface ReviewRecallCase {
  /** "<pr>-<slug>" */
  id: string;
  lane: ReviewLane;
  provenance: { pr: number; reviewedSha: string; mergeBase: string; commentUrl: string };
  /** acceptanceCriteria is required non-empty for lane 'requirements'. */
  issue: { id: string; title: string; acceptanceCriteria: string[] };
  /** Unified diff, at most MAX_DIFF_CHARS. */
  diff: string;
  blocker: {
    title: string;
    /** Repo-relative. */
    file: string;
    lines: number[];
    /** 3-6 distinctive lowercase terms from the finding. */
    keywords: string[];
  };
}

export type FindingGlyph = '!' | '⊗' | '~' | '≉' | '?';

export interface ParsedFinding {
  glyph: FindingGlyph;
  blocking: boolean;
  title: string;
  file: string | null;
  line: number | null;
  body: string;
}

export const MAX_DIFF_CHARS = 60_000;
const LANES: readonly ReviewLane[] = ['correctness', 'performance', 'requirements'];

function fail(label: string, message: string): never {
  throw new Error(`Invalid review-recall case ${label}: ${message}`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function parseReviewRecallCase(data: unknown): ReviewRecallCase {
  const c = data as Partial<ReviewRecallCase> | null;
  if (!c || typeof c !== 'object') fail('(unknown)', 'not an object');
  const label = typeof c.id === 'string' && c.id !== '' ? c.id : fail('(unknown)', 'missing id');
  if (!LANES.includes(c.lane as ReviewLane)) fail(label, `lane must be one of ${LANES.join(', ')}`);
  const p = c.provenance;
  if (
    !p ||
    typeof p.pr !== 'number' ||
    typeof p.reviewedSha !== 'string' ||
    typeof p.mergeBase !== 'string' ||
    typeof p.commentUrl !== 'string'
  ) {
    fail(label, 'provenance needs pr, reviewedSha, mergeBase and commentUrl');
  }
  const issue = c.issue;
  if (!issue || typeof issue.id !== 'string' || typeof issue.title !== 'string' || !isStringArray(issue.acceptanceCriteria)) {
    fail(label, 'issue needs id, title and an acceptanceCriteria array');
  }
  if (c.lane === 'requirements' && issue.acceptanceCriteria.length === 0) {
    fail(label, 'a requirements-lane case needs at least one acceptance criterion');
  }
  if (typeof c.diff !== 'string' || c.diff.trim() === '') fail(label, 'diff must be a non-empty string');
  if (c.diff.length > MAX_DIFF_CHARS) fail(label, `diff is ${c.diff.length} chars, over ${MAX_DIFF_CHARS}`);
  const b = c.blocker;
  if (
    !b ||
    typeof b.title !== 'string' ||
    typeof b.file !== 'string' ||
    b.file === '' ||
    !Array.isArray(b.lines) ||
    !b.lines.every((n) => Number.isInteger(n)) ||
    !isStringArray(b.keywords) ||
    b.keywords.length === 0
  ) {
    fail(label, 'blocker needs title, file, integer lines and non-empty keywords');
  }
  return c as ReviewRecallCase;
}

// `### <glyph> <title>` with an optional ` — \`path:line\`` location. The location is
// optional because roles/review-requirements.md headings name a requirement source, not a
// file; such findings take their location from the first file citation in the body.
const HEADING_RE = /^###\s+(!|⊗|~|≉|\?)\s+(.+?)\s*$/gm;
const LOCATION_RE = /\s+[—–-]\s+`([^`]+)`/;
const BODY_CITATION_RE = /`([^`\s]+)`/g;
const PATH_LIKE_RE = /^(?:\.\/)?[\w@~.-]+(?:\/[\w@~.-]+)*\.[A-Za-z0-9]+$/;

function parseLocation(raw: string): { file: string; line: number | null } | null {
  const m = raw.trim().match(/^([^:\s]+)(?::(\d+))?/);
  if (!m || !PATH_LIKE_RE.test(m[1]!)) return null;
  return { file: m[1]!, line: m[2] !== undefined ? Number(m[2]) : null };
}

export function parseFindings(report: string): ParsedFinding[] {
  return [...report.matchAll(HEADING_RE)].map((m) => {
    const glyph = m[1] as FindingGlyph;
    const headingText = m[2]!;
    const bodyStart = m.index! + m[0].length;
    const rest = report.slice(bodyStart);
    const nextHeading = rest.search(/^#{2,3}\s/m);
    const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();

    let title = headingText;
    let location: { file: string; line: number | null } | null = null;
    const loc = headingText.match(LOCATION_RE);
    if (loc) {
      location = parseLocation(loc[1]!);
      if (location) title = headingText.slice(0, loc.index).trim();
    }
    if (!location) {
      for (const cite of body.matchAll(BODY_CITATION_RE)) {
        location = parseLocation(cite[1]!);
        if (location) break;
      }
    }

    return {
      glyph,
      blocking: glyph === '!' || glyph === '⊗',
      title,
      file: location?.file ?? null,
      line: location?.line ?? null,
      body,
    };
  });
}

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '');
}

function sameFile(cited: string, blockerFile: string): boolean {
  const a = normalizePath(cited);
  const b = normalizePath(blockerFile);
  // A model may cite the path with a checkout prefix (workspaces/feature-x/src/...).
  return a === b || a.endsWith(`/${b}`);
}

export function findingMatchesBlocker(
  f: ParsedFinding,
  blocker: ReviewRecallCase['blocker'],
  opts: { lineWindow?: number; minKeywordHits?: number } = {},
): boolean {
  const lineWindow = opts.lineWindow ?? 15;
  const minKeywordHits = opts.minKeywordHits ?? 2;
  if (!f.blocking || f.file === null || !sameFile(f.file, blocker.file)) return false;
  if (f.line !== null && blocker.lines.some((l) => Math.abs(l - f.line!) <= lineWindow)) return true;
  const text = `${f.title}\n${f.body}`.toLowerCase();
  const hits = blocker.keywords.filter((k) => text.includes(k.toLowerCase())).length;
  return hits >= minKeywordHits;
}

export function scoreReviewRecall(
  report: string,
  c: ReviewRecallCase,
): { recall: 0 | 1; precision: number | null; blockingCount: number; score: number } {
  const blocking = parseFindings(report).filter((f) => f.blocking);
  const matching = blocking.filter((f) => findingMatchesBlocker(f, c.blocker)).length;
  const recall: 0 | 1 = matching > 0 ? 1 : 0;
  return {
    recall,
    precision: blocking.length === 0 ? null : matching / blocking.length,
    blockingCount: blocking.length,
    score: recall,
  };
}
