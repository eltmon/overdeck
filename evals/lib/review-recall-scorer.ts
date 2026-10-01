// E2 review recall: does a review lane's report contain a finding that matches the known
// blocker a real review convoy raised on the same diff, and does it rate it blocking?
// Pure: no fs, no network.

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
  /** The primary location: the heading location, else the first citation. */
  file: string | null;
  line: number | null;
  /** Every location the finding cites: the heading location first, then body citations in order. */
  citations: FindingCitation[];
  body: string;
}

export interface FindingCitation {
  file: string;
  line: number | null;
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
// `- **~ title**`, `- \`≉\` **title**`, `* ? title`: a finding written as a top-level list item.
const BULLET_RE = /^[-*]\s+(?:\*\*|`)?\s*(!|⊗|~|≉|\?)(?:\*\*|`)?\s+(.+?)\s*$/gm;
const LOCATION_RE = /\s+[—–-]\s+`([^`]+)`/;
const BODY_CITATION_RE = /`([^`\s]+)`/g;
const PATH_LIKE_RE = /^(?:\.\/)?[\w@~.-]+(?:\/[\w@~.-]+)*\.[A-Za-z0-9]+$/;

function parseLocation(raw: string): FindingCitation | null {
  const m = raw.trim().match(/^([^:\s]+)(?::(\d+))?/);
  if (!m || !PATH_LIKE_RE.test(m[1]!)) return null;
  return { file: m[1]!, line: m[2] !== undefined ? Number(m[2]) : null };
}

/** `first` (when present), then every path-like backticked citation in `text`, de-duplicated. */
function collectCitations(first: FindingCitation | null, text: string): FindingCitation[] {
  const citations: FindingCitation[] = [];
  const seen = new Set<string>();
  const add = (c: FindingCitation | null): void => {
    if (!c || seen.has(`${c.file}:${c.line}`)) return;
    seen.add(`${c.file}:${c.line}`);
    citations.push(c);
  };
  add(first);
  for (const cite of text.matchAll(BODY_CITATION_RE)) add(parseLocation(cite[1]!));
  return citations;
}

interface PositionedFinding {
  start: number;
  end: number;
  finding: ParsedFinding;
}

function parseHeadingFindings(report: string): PositionedFinding[] {
  return [...report.matchAll(HEADING_RE)].map((m) => {
    const glyph = m[1] as FindingGlyph;
    const headingText = m[2]!;
    const bodyStart = m.index! + m[0].length;
    const rest = report.slice(bodyStart);
    const nextHeading = rest.search(/^#{2,3}\s/m);
    const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();

    let title = headingText;
    let location: FindingCitation | null = null;
    const loc = headingText.match(LOCATION_RE);
    if (loc) {
      location = parseLocation(loc[1]!);
      if (location) title = headingText.slice(0, loc.index).trim();
    }
    const citations = collectCitations(location, body);
    const primary = location ?? citations[0] ?? null;

    return {
      start: m.index!,
      end: nextHeading === -1 ? report.length : bodyStart + nextHeading,
      finding: {
        glyph,
        blocking: glyph === '!' || glyph === '⊗',
        title,
        file: primary?.file ?? null,
        line: primary?.line ?? null,
        citations,
        body,
      },
    };
  });
}

/** Glyph-bullet findings; a bullet's body is its following indented (or blank) lines. Never blocking. */
function parseBulletFindings(report: string, headingRanges: Array<{ start: number; end: number }>): PositionedFinding[] {
  const found: PositionedFinding[] = [];
  for (const m of report.matchAll(BULLET_RE)) {
    const start = m.index!;
    // A list item inside a heading finding's body belongs to that finding.
    if (headingRanges.some((r) => start > r.start && start < r.end)) continue;
    const bodyLines: string[] = [];
    for (const line of report.slice(start + m[0].length).split('\n').slice(1)) {
      if (line.trim() !== '' && !/^\s/.test(line)) break;
      bodyLines.push(line);
    }
    const body = bodyLines.join('\n').trim();
    const title = m[2]!.replace(/\*\*/g, '').trim();
    const citations = collectCitations(null, `${m[2]!}\n${body}`);
    found.push({
      start,
      end: start + m[0].length,
      finding: {
        glyph: m[1] as FindingGlyph,
        blocking: false,
        title,
        file: citations[0]?.file ?? null,
        line: citations[0]?.line ?? null,
        citations,
        body,
      },
    });
  }
  return found;
}

/** Heading findings and glyph-bullet findings, in report order. */
export function parseFindings(report: string): ParsedFinding[] {
  const headings = parseHeadingFindings(report);
  return [...headings, ...parseBulletFindings(report, headings)].sort((a, b) => a.start - b.start).map((p) => p.finding);
}

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '');
}

function sameFile(cited: string, blockerFile: string): boolean {
  const a = normalizePath(cited);
  const b = normalizePath(blockerFile);
  // A model may cite the path with a checkout prefix (workspaces/feature-x/src/...)
  // or shorten it to a trailing part that keeps the basename (hooks/useX.ts, useX.ts).
  return a === b || a.endsWith(`/${b}`) || (/\.[A-Za-z0-9]+$/.test(a) && b.endsWith(`/${a}`));
}

export function findingMatchesBlocker(
  f: ParsedFinding,
  blocker: ReviewRecallCase['blocker'],
  opts: { lineWindow?: number; minKeywordHits?: number } = {},
): boolean {
  const lineWindow = opts.lineWindow ?? 15;
  const minKeywordHits = opts.minKeywordHits ?? 2;
  const text = `${f.title}\n${f.body}`.toLowerCase();
  const keywordMatch = blocker.keywords.filter((k) => text.includes(k.toLowerCase())).length >= minKeywordHits;
  // Severity is the caller's concern; any cited location of the blocker file can match.
  return f.citations.some(
    (c) =>
      sameFile(c.file, blocker.file) &&
      (keywordMatch || (c.line !== null && blocker.lines.some((l) => Math.abs(l - c.line!) <= lineWindow))),
  );
}

export interface ReviewRecallScores {
  /** Any finding (heading or bullet, any glyph) matches the blocker. */
  recall: 0 | 1;
  /** A blocking (! or ⊗) heading finding matches: what production review gating counts. */
  blockingRecall: 0 | 1;
  /** Given recall, whether the model rated the blocker blocking; null when it did not find it. */
  blockingSeverity: 0 | 1 | null;
  /** Matching findings / all findings, any severity; null when the report has no findings. */
  precision: number | null;
  findingCount: number;
  blockingCount: number;
  /** = recall */
  score: number;
}

export function scoreReviewRecall(report: string, c: ReviewRecallCase): ReviewRecallScores {
  const findings = parseFindings(report);
  const matching = findings.filter((f) => findingMatchesBlocker(f, c.blocker));
  const recall: 0 | 1 = matching.length > 0 ? 1 : 0;
  const blockingRecall: 0 | 1 = matching.some((f) => f.blocking) ? 1 : 0;
  return {
    recall,
    blockingRecall,
    blockingSeverity: recall === 1 ? blockingRecall : null,
    precision: findings.length === 0 ? null : matching.length / findings.length,
    findingCount: findings.length,
    blockingCount: findings.filter((f) => f.blocking).length,
    score: recall,
  };
}
