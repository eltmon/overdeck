/**
 * Posting a review verdict where the forge keeps it (PAN-3917, FR-7).
 *
 * The reviewer role used to write a verdict into a `review_status` row and a
 * per-issue record, and a patrol reconciled the two. Now the verdict is a pull
 * request review: `approve` or `request changes`. The work agent's feedback is
 * keyed off the PR's own review state, so there is nothing to reconcile.
 *
 * GitLab has no "request changes" primitive. An approval is `glab mr approve`;
 * a rejection is an MR note, and the MR simply stays unapproved — which is what
 * `pr-facts` reports back as `REVIEW_REQUIRED`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseArtifactRef } from '../forge.js';
import { getPrFacts, parseGitLabProjectPath, type PrFacts } from './pr-facts.js';

const execFileAsync = promisify(execFile);

export type ReviewVerdict = 'approve' | 'request-changes' | 'comment';

export interface PostReviewVerdictInput {
  issueId: string;
  verdict: ReviewVerdict;
  body: string;
  /** Skips the forge lookup when the caller already has the facts. */
  facts?: PrFacts;
}

export type PostReviewVerdictResult =
  | { posted: true; forge: 'github' | 'gitlab'; url: string | null; verdict: ReviewVerdict }
  | { posted: false; reason: string };

export interface PostReviewVerdictDeps {
  getFacts?: typeof getPrFacts;
  runGh?: (args: string[]) => Promise<void>;
  runGlab?: (args: string[]) => Promise<void>;
}

async function defaultRunGh(args: string[]): Promise<void> {
  await execFileAsync('gh', args, { encoding: 'utf-8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
}

async function defaultRunGlab(args: string[]): Promise<void> {
  await execFileAsync('glab', args, { encoding: 'utf-8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
}

function githubRepoArg(url: string | null): string | null {
  const match = url?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Post the reviewer's verdict onto the issue's PR/MR. Returns `posted: false`
 * with a reason instead of throwing, so a reviewer that finished against a
 * closed or missing PR reports the fact rather than crashing its run.
 */
export async function postReviewVerdict(
  input: PostReviewVerdictInput,
  deps: PostReviewVerdictDeps = {},
): Promise<PostReviewVerdictResult> {
  const facts = input.facts ?? await (deps.getFacts ?? getPrFacts)(input.issueId);
  if (facts.error) return { posted: false, reason: facts.error };
  if (!facts.exists || !facts.url) return { posted: false, reason: 'no pull request to review' };
  if (facts.merged) return { posted: false, reason: 'PR is already merged' };
  if (facts.closed) return { posted: false, reason: 'PR is closed' };

  const ref = parseArtifactRef(facts.url);
  if (!ref) return { posted: false, reason: `unrecognized artifact URL ${facts.url}` };

  if (ref.forge === 'github') {
    const repo = githubRepoArg(facts.url);
    if (!repo) return { posted: false, reason: `unrecognized GitHub PR URL ${facts.url}` };
    const flag = input.verdict === 'approve'
      ? '--approve'
      : input.verdict === 'request-changes'
        ? '--request-changes'
        : '--comment';
    try {
      await (deps.runGh ?? defaultRunGh)([
        'pr', 'review', String(ref.number), '--repo', repo, flag, '--body', input.body,
      ]);
    } catch (cause) {
      return { posted: false, reason: `gh pr review failed: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
    return { posted: true, forge: 'github', url: facts.url, verdict: input.verdict };
  }

  const projectPath = parseGitLabProjectPath(facts.url);
  if (!projectPath) return { posted: false, reason: `unrecognized GitLab MR URL ${facts.url}` };
  const runGlab = deps.runGlab ?? defaultRunGlab;
  try {
    if (input.body.trim()) {
      await runGlab(['mr', 'note', String(ref.number), '-R', projectPath, '-m', input.body]);
    }
    if (input.verdict === 'approve') {
      await runGlab(['mr', 'approve', String(ref.number), '-R', projectPath]);
    }
  } catch (cause) {
    return { posted: false, reason: `glab mr review failed: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  return { posted: true, forge: 'gitlab', url: facts.url, verdict: input.verdict };
}
