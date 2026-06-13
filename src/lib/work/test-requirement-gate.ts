/**
 * Pure helpers for the PAN-1501 test-requirement gate.
 *
 * The gate detects when an issue's body asks for tests but the feature branch
 * adds no new lines under test files. This module holds the pure functions only;
 * orchestration lives in done-preflight.ts.
 */

export interface TestRequirement {
  /** The keyword / phrase that matched. */
  keyword: string;
  /** 1-indexed line number in the source text. */
  line: number;
  /** The full source line (trimmed) containing the match. */
  context: string;
}

/**
 * Keyword patterns used to decide whether an issue body is asking for tests.
 *
 * Exported as a source of truth for both the detector and its tests.
 */
export const TEST_REQUIREMENT_KEYWORDS: ReadonlyArray<{ readonly keyword: string; readonly pattern: RegExp }> = [
  { keyword: 'test', pattern: /\btest\b/i },
  { keyword: 'regression test', pattern: /regression test/i },
  { keyword: 'unit test', pattern: /unit test/i },
  { keyword: 'Test:', pattern: /Test:/i },
  { keyword: '## Test plan', pattern: /## Test plan/i },
  { keyword: 'vitest', pattern: /vitest/i },
  { keyword: 'playwright', pattern: /playwright/i },
];

/**
 * Scan freeform issue text for test-shaped keywords.
 *
 * @returns One entry per match per line; empty/null input returns an empty array.
 */
export function detectTestRequirements(text: string | null | undefined): TestRequirement[] {
  if (!text) return [];

  const results: TestRequirement[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    for (const { keyword, pattern } of TEST_REQUIREMENT_KEYWORDS) {
      if (pattern.test(line)) {
        results.push({ keyword, line: i + 1, context: trimmed });
      }
    }
  }

  return results;
}
