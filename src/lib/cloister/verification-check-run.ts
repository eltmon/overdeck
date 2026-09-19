/**
 * Reporting verification results as a GitHub check run (PAN-3917, FR-8).
 *
 * Verification (typecheck, lint, tests, stub-UI lint, test-skip gate) used to
 * write a `verificationStatus` field that a patrol then had to reconcile. It now
 * has exactly two outputs, both owned by something else:
 *
 *   1. `<workspace>/.overdeck/verification-latest.json` — the workspace artifact
 *      written by `verification-artifact.ts` and read by the dashboard's Lint row.
 *   2. An `overdeck/verification` check run on the tested commit, where the
 *      GitHub App is installed. GitHub owns it from there.
 *
 * `github-app.ts` posts commit *statuses* (`reportCommitStatus`), which carry no
 * output body. A check run carries the failing gate's name and detail, so the
 * PR page shows why verification failed without opening the dashboard. This is
 * the smallest function that does that; failures are non-fatal by design.
 */
import { Effect } from 'effect';

import {
  generateInstallationToken,
  isGitHubAppConfigured,
  loadGitHubAppConfig,
} from '../github-app.js';

export type CheckRunConclusion = 'success' | 'failure' | 'neutral' | 'skipped';

export interface VerificationCheckRunInput {
  owner: string;
  repo: string;
  /** The exact commit the gates ran against. */
  headSha: string;
  conclusion: CheckRunConclusion;
  /** One-line summary, e.g. `typecheck failed` or `all gates passed`. */
  title: string;
  /** Markdown detail shown on the PR's Checks tab. */
  summary: string;
}

export interface VerificationCheckRunDeps {
  fetchImpl?: typeof fetch;
  isConfigured?: () => boolean;
  getToken?: () => Promise<string>;
}

export const VERIFICATION_CHECK_RUN_NAME = 'overdeck/verification';

async function defaultGetToken(): Promise<string> {
  const config = loadGitHubAppConfig();
  if (!config) throw new Error('GitHub App not configured');
  const { token } = await Effect.runPromise(generateInstallationToken(config));
  return token;
}

/**
 * Post (or re-post) the verification check run for a commit.
 *
 * Returns true when GitHub accepted it, false when the App is not installed or
 * the call failed. Never throws: a reporting failure must not change the
 * verification outcome itself.
 */
export async function postVerificationCheckRun(
  input: VerificationCheckRunInput,
  deps: VerificationCheckRunDeps = {},
): Promise<boolean> {
  const configured = deps.isConfigured ?? isGitHubAppConfigured;
  if (!configured()) return false;
  if (!input.headSha) return false;

  try {
    const token = await (deps.getToken ?? defaultGetToken)();
    const doFetch = deps.fetchImpl ?? fetch;
    const response = await doFetch(
      `https://api.github.com/repos/${input.owner}/${input.repo}/check-runs`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'overdeck',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: VERIFICATION_CHECK_RUN_NAME,
          head_sha: input.headSha,
          status: 'completed',
          conclusion: input.conclusion,
          completed_at: new Date().toISOString(),
          output: {
            title: input.title,
            summary: input.summary.slice(0, 65_000),
          },
        }),
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[verification] check run rejected: ${response.status} ${text}`);
      return false;
    }
    return true;
  } catch (cause) {
    console.warn(`[verification] check run failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return false;
  }
}
