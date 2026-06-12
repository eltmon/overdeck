/**
 * Stub UI pattern catalog (PAN-1500 / PAN-1454 pattern 4).
 *
 * This module defines a deterministic, regex-based catalog of code shapes that
 * strongly suggest a PR is merging a UI stub: a new tab, mode, or routed view
 * whose data layer is faked, whose handlers no-op, or whose copy apologizes for
 * missing functionality. The catalog is best-effort, not exhaustive — extend it
 * when new stub shapes escape post-merge audits.
 *
 * The globs and patterns are consumed by `scanStubUi()` in
 * `src/lib/cloister/lint-stub-ui.ts`, which restricts inspection to added (+)
 * lines in frontend UI affordance files. Reviewers see the emitted findings on
 * the review context manifest and must block unless the diff also shows one of
 * the three valid mitigations: a feature flag guarding the affordance off,
 * removal of the affordance from the user-facing surface, or a non-stub
 * implementation calling real data.
 */

export type StubUiSeverity = 'block' | 'advisory';

export interface StubUiFinding {
  patternId: StubUiPatternId;
  patternLabel: string;
  filePath: string;
  lineNumber: number;
  addedLine: string;
  severity: StubUiSeverity;
}

export interface StubUiPattern {
  id: StubUiPatternId;
  label: string;
  regex: RegExp;
  severity: StubUiSeverity;
}

/**
 * Micromatch-compatible globs naming the file types that can introduce
 * user-facing UI affordances. The scanner applies additional status logic:
 * - Added (A) files under `src/dashboard/frontend/src/components/` are in scope.
 * - Modified (M) files are in scope only when they match the `*Tab.tsx`,
 *   `*Mode.tsx`, or `*View.tsx` suffix globs, because modifications to generic
 *   components are unlikely to introduce brand-new affordances.
 */
export const STUB_UI_FILE_GLOBS = [
  'src/dashboard/frontend/src/components/**/*Tab.tsx',
  'src/dashboard/frontend/src/components/**/*Mode.tsx',
  'src/dashboard/frontend/src/components/**/*View.tsx',
  'src/dashboard/frontend/src/components/**/*.tsx',
] as const;

/**
 * Stable pattern identifiers. Downstream beads (scanner, prompt) can reference
 * these by name via `typeof STUB_UI_PATTERNS[number]['id']`.
 */
export type StubUiPatternId =
  | 'coming-soon-copy'
  | 'empty-array-return'
  | 'null-return'
  | 'use-state-false'
  | 'new-tab-or-route'
  | 'segmented-control-noop'
  | 'noop-handler';

/**
 * Regex catalog of stub shapes. Each pattern is applied to individual added
 * lines, so patterns must not rely on multi-line context.
 */
export const STUB_UI_PATTERNS: StubUiPattern[] = [
  {
    id: 'coming-soon-copy',
    label: 'Copy suggests the feature is not implemented ("coming soon" / "not yet implemented")',
    // Ignore lines that begin with a // comment so TODO/notes don't drown out
    // real user-facing copy. JSX text and quoted strings are still caught.
    regex: /^(?!\s*\/\/).*?\b(?:[Cc]oming\s+soon|[Nn]ot\s+yet\s+implemented)\b/,
    severity: 'block',
  },
  {
    id: 'empty-array-return',
    label: 'Hook/function returns an empty array',
    regex: /^\s*return\s*\[\s*\]\s*;/,
    severity: 'block',
  },
  {
    id: 'null-return',
    label: 'Hook/function returns null',
    regex: /^\s*return\s+null\s*;/,
    severity: 'block',
  },
  {
    id: 'use-state-false',
    label: 'Tab/mode state initialized to false with no other writer suspected',
    regex: /\buseState\s*\(\s*false\s*\)/,
    severity: 'advisory',
  },
  {
    id: 'new-tab-or-route',
    label: 'New Tab, TabPanel, or Route JSX entry added',
    regex: /<(?:Tab|TabPanel|Route)\b/,
    severity: 'advisory',
  },
  {
    id: 'segmented-control-noop',
    label: 'Segmented-control or mode onChange handler is a no-op arrow function',
    // Matches both JSX prop form `onChange={() => {}}` and object form
    // `onChange: () => {},`. The outer braces are optional.
    regex: /onChange\s*[:=]\s*\{?\s*\(\s*\)\s*=>\s*(?:\{\s*\}|null|undefined)\s*\}?/,
    severity: 'block',
  },
  {
    id: 'noop-handler',
    label: 'Explicit onClick/onSelect/onSubmit handler is a no-op arrow function',
    // Matches JSX prop form `onClick={() => {}}` and object form
    // `onClick: () => {},`. Outer braces are optional.
    regex: /on(?:Click|Select|Submit)\s*[:=]\s*\{?\s*\(\s*\)\s*=>\s*(?:\{\s*\}|null|undefined)\s*\}?/,
    severity: 'block',
  },
];

/**
 * Convert a micromatch-style glob (supporting `*` and `**`) to a RegExp.
 * This is intentionally minimal: it covers the globs exported above and avoids
 * adding a dependency on `micromatch` for a small, stable set of patterns.
 */
function globToRegex(glob: string): RegExp {
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        pattern += '(?:.*/)?';
        i += 3;
        continue;
      }
      pattern += '.*';
      i += 2;
      continue;
    }
    if (c === '*') {
      pattern += '[^/]*';
      i += 1;
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(c)) {
      pattern += `\\${c}`;
      i += 1;
      continue;
    }
    pattern += c;
    i += 1;
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Test whether a repository-relative file path matches any of the stub-UI
 * file globs. This is the public entry point used by the scanner.
 */
export function matchesStubUiFileGlob(filePath: string): boolean {
  for (const glob of STUB_UI_FILE_GLOBS) {
    if (globToRegex(glob).test(filePath)) return true;
  }
  return false;
}

/**
 * Status-aware scope check. Added component files are in scope because they may
 * introduce brand-new affordances; modified files are inspected only when their
 * basename suggests they are UI affordance files (*Tab/*Mode/*View).
 */
export function isStubUiFileInScope(filePath: string, status: 'A' | 'M' | string): boolean {
  if (status === 'A') {
    return matchesStubUiFileGlob(filePath);
  }
  // Modified files: only the explicit affordance suffixes.
  const affordanceGlobs = STUB_UI_FILE_GLOBS.slice(0, 3);
  for (const glob of affordanceGlobs) {
    if (globToRegex(glob).test(filePath)) return true;
  }
  return false;
}
