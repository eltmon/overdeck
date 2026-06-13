/**
 * Pure helpers for the PAN-1501 test-requirement gate.
 *
 * The gate detects when an issue's body asks for tests but the feature branch
 * adds no new lines under test files. This module holds the pure functions only;
 * orchestration lives in done-preflight.ts.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { Data, Effect } from 'effect';
import { extractNumberSync, extractPrefixSync } from '../issue-id.js';
import { getLinearApiKey } from '../shadow-utils.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execAsync = promisify(exec);

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
 * File-path pattern for test files considered by the test-requirement gate.
 *
 * Matches `.test.ts`, `.spec.ts`, `.test.tsx`, and `.spec.tsx` suffixes.
 */
export const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/i;

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

/**
 * Sum new lines added to test files from `git diff --numstat` output.
 *
 * `numstatOutput` lines are tab-separated: `<additions>\t<deletions>\t<path>`.
 * Binary entries (`-\t-\t<path>`) are skipped. Malformed lines are tolerated.
 */
export function countTestDeltaInDiff(numstatOutput: string): number {
  if (!numstatOutput) return 0;

  let total = 0;
  const lines = numstatOutput.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;

    const [additionsRaw, , path] = parts;
    if (additionsRaw === '-') continue; // binary entry

    const additions = Number.parseInt(additionsRaw, 10);
    if (!Number.isFinite(additions) || additions < 0) continue;

    if (TEST_FILE_PATTERN.test(path ?? '')) {
      total += additions;
    }
  }

  return total;
}

/**
 * Error raised when the issue-body fetcher cannot retrieve the body for a
 * reason other than an unreachable/unauthenticated tracker.
 */
export class TrackerFetchError extends Data.TaggedError('TrackerFetchError')<{
  issueId: string;
  message: string;
  cause?: unknown;
}> {}

/**
 * Fetch the raw issue body for the test-requirement gate.
 *
 * Supports GitHub (`gh issue view`) and Linear (LinearClient SDK). Returns
 * `null` when the tracker is unreachable, unauthenticated, or the issue is
 * missing, so the orchestrator can decide whether to abort.
 */
export function fetchIssueBodyForGate(issueId: string): Effect.Effect<string | null, TrackerFetchError> {
  return Effect.gen(function* () {
    const ghInfo = resolveGitHubIssueSync(issueId);

    if (ghInfo.isGitHub) {
      const command = `gh issue view ${ghInfo.number} --repo ${ghInfo.owner}/${ghInfo.repo} --json body --jq '.body'`;
      const result = yield* Effect.tryPromise({
        try: () => execAsync(command),
        catch: (cause) =>
          new TrackerFetchError({
            issueId,
            message: `gh issue view failed for ${issueId}`,
            cause,
          }),
      }).pipe(Effect.catchTag('TrackerFetchError', () => Effect.succeed(null)));
      if (result === null) return null;
      return result.stdout.trim();
    }

    const issueNum = extractNumberSync(issueId);
    const teamKey = extractPrefixSync(issueId);
    if (issueNum === null || teamKey === null) {
      return yield* Effect.fail(
        new TrackerFetchError({
          issueId,
          message: `Could not parse issue ID ${issueId} for Linear lookup`,
        }),
      );
    }

    const apiKey = yield* getLinearApiKey();
    if (apiKey === null) return null;

    const { LinearClient } = yield* Effect.tryPromise({
      try: () => import('@linear/sdk'),
      catch: (cause) =>
        new TrackerFetchError({
          issueId,
          message: `Failed to load @linear/sdk for ${issueId}`,
          cause,
        }),
    });

    const client = new LinearClient({ apiKey });
    const response = yield* Effect.tryPromise({
      try: () =>
        client.issues({
          filter: {
            number: { eq: issueNum },
            team: { key: { eq: teamKey } },
          },
          first: 1,
        }),
      catch: (cause) =>
        new TrackerFetchError({
          issueId,
          message: `Linear issues query failed for ${issueId}`,
          cause,
        }),
    }).pipe(Effect.catchTag('TrackerFetchError', () => Effect.succeed(null)));

    if (response === null || response.nodes.length === 0) return null;

    const description = yield* Effect.tryPromise({
      try: () => response.nodes[0].description,
      catch: (cause) =>
        new TrackerFetchError({
          issueId,
          message: `Failed to read Linear issue description for ${issueId}`,
          cause,
        }),
    }).pipe(Effect.catchTag('TrackerFetchError', () => Effect.succeed(null)));

    return description ?? null;
  });
}
