/**
 * Pure-function validator for the requirements reviewer's live-code-path trace
 * output. Parses the review markdown and fails closed when in-PR-scope
 * Implemented/Partial ACs are missing a backticked `path:line` trace.
 */

export interface RequirementsTraceValidationResult {
  ok: boolean;
  /** Titles of in_pr_scope Implemented/Partial ACs missing a usable trace */
  missingTraces: string[];
  /** Human-readable one-line reason for REVIEWER_FAILED; empty when ok */
  reason: string;
}

const SENTINEL_BODY = 'None — no in_pr_scope ACs claimed Implemented or Partial.';
const SECTION_HEADER = '## Live Code Path Traces';
const FILE_LINE_REGEX = /^`[^`\s\\]+\.[A-Za-z0-9]+:\d+`$/;

/**
 * Parse a Coverage Matrix table row and return the scope and status if present.
 * The expected column order is: Requirement | Source | Scope | Status | Evidence
 */
function parseCoverageRow(row: string): { title: string; scope: string; status: string } | undefined {
  const cells = row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

  if (cells.length < 5) return undefined;

  const [title, , scope, status] = cells;
  if (!title || !scope || !status) return undefined;

  return { title, scope, status };
}

function extractSection(markdown: string, header: string): string | undefined {
  const idx = markdown.indexOf(header);
  if (idx === -1) return undefined;

  const afterHeader = markdown.slice(idx + header.length);
  // Section ends at the next ## header (exactly two hashes, not ###) or end of document.
  const nextHeaderMatch = afterHeader.match(/\n## [^#\n]/);
  if (!nextHeaderMatch) return afterHeader.trim();

  return afterHeader.slice(0, nextHeaderMatch.index).trim();
}

function parseRequiredACs(markdown: string): string[] {
  const required: string[] = [];
  const section = extractSection(markdown, '## Coverage Matrix');
  if (!section) return required;

  const lines = section.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (trimmed.includes('---')) continue; // header separator

    const parsed = parseCoverageRow(trimmed);
    if (!parsed) continue;

    const { title, scope, status } = parsed;
    const statusLower = status.toLowerCase();
    if (scope === 'in_pr_scope' && (statusLower === 'implemented' || statusLower === 'partial')) {
      required.push(title);
    }
  }

  return required;
}

function parseTraceBlocks(section: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const lines = section.split('\n');
  let currentTitle: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('### AC:')) {
      currentTitle = line.slice('### AC:'.length).trim();
      continue;
    }
    if (!currentTitle) continue;
    if (line.startsWith('**File:**')) {
      const value = line.slice('**File:**'.length).trim();
      // Accept if any backtick-delimited token in the value matches the file regex.
      const tokens = value.split('`').filter((_, i) => i % 2 === 1);
      const validToken = tokens.map((t) => `\`${t}\``).find((t) => FILE_LINE_REGEX.test(t));
      if (validToken) {
        blocks.set(currentTitle, validToken);
      }
    }
  }

  return blocks;
}

function buildReason(missing: string[]): string {
  const prefix = 'requirements review missing live code path trace for ACs: ';
  const joined = missing.join(', ');
  const full = prefix + joined;
  if (full.length <= 240) return full;
  return full.slice(0, 237) + '...';
}

export function validateRequirementsTrace(markdown: string): RequirementsTraceValidationResult {
  const required = parseRequiredACs(markdown);
  const traceSection = extractSection(markdown, SECTION_HEADER);

  if (!traceSection) {
    return {
      ok: false,
      missingTraces: required,
      reason: buildReason(required),
    };
  }

  if (required.length === 0) {
    const isSentinel = traceSection === SENTINEL_BODY;
    return {
      ok: isSentinel,
      missingTraces: [],
      reason: isSentinel ? '' : buildReason([]),
    };
  }

  const blocks = parseTraceBlocks(traceSection);
  const missing: string[] = [];

  for (const title of required) {
    const fileValue = blocks.get(title);
    if (!fileValue || !FILE_LINE_REGEX.test(fileValue)) {
      missing.push(title);
    }
  }

  if (missing.length === 0) {
    return { ok: true, missingTraces: [], reason: '' };
  }

  return {
    ok: false,
    missingTraces: missing,
    reason: buildReason(missing),
  };
}
