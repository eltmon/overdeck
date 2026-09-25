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
 *
 * Two GitHub identities matter here. GitHub refuses any review on your own pull
 * request, so on a single-account install every verdict was rejected and
 * `reviewDecision` stayed empty forever — no rework delivery, no merge-ready
 * set. So: post as the GitHub App when it is installed (the bot is never the
 * author), and when the forge still refuses, post the verdict as a PR comment
 * carrying the `overdeck-verdict` marker that `pr-facts` reads back.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { parseArtifactRef } from '../forge.js';
import { generateInstallationToken, isGitHubAppConfigured } from '../github-app.js';
import {
  formatVerdictMarker,
  getPrFacts,
  parseGitLabProjectPath,
  type MarkerVerdict,
  type PrFacts,
} from './pr-facts.js';

const execFileAsync = promisify(execFile);

export type ReviewVerdict = 'approve' | 'request-changes' | 'comment';

export interface PostReviewVerdictInput {
  issueId: string;
  verdict: ReviewVerdict;
  body: string;
  /** Skips the forge lookup when the caller already has the facts. */
  facts?: PrFacts;
  /**
   * #3853: the commit the reviewer actually reviewed (a full or abbreviated
   * sha, from its run id). The verdict marker names the head (`sha=`) only
   * when the head is still this commit. A head that moved during the review,
   * or an unknown reviewed commit, leaves the marker without `sha=`: it then
   * proves nothing, and the verdict guard never refuses on it.
   */
  reviewedHead?: string | null;
}

/** The head sha when it is the reviewed commit, else null. */
function reviewedHeadSha(headSha: string | null | undefined, reviewedHead: string | null | undefined): string | null {
  if (!headSha || !reviewedHead) return null;
  return headSha.toLowerCase().startsWith(reviewedHead.toLowerCase()) ? headSha : null;
}

export type PostReviewVerdictResult =
  | {
    posted: true;
    forge: 'github' | 'gitlab';
    url: string | null;
    verdict: ReviewVerdict;
    /** How the verdict reached the forge: a real review, or a marker comment. */
    via?: 'review' | 'comment';
  }
  | { posted: false; reason: string };

export interface RunGhOptions {
  env?: NodeJS.ProcessEnv;
}

export interface PostReviewVerdictDeps {
  getFacts?: typeof getPrFacts;
  runGh?: (args: string[], options?: RunGhOptions) => Promise<void>;
  runGlab?: (args: string[]) => Promise<void>;
  isAppConfigured?: () => boolean;
  getAppToken?: () => Promise<string>;
}

async function defaultRunGh(args: string[], options: RunGhOptions = {}): Promise<void> {
  await execFileAsync('gh', args, {
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    ...(options.env ? { env: options.env } : {}),
  });
}

async function defaultAppToken(): Promise<string> {
  const { token } = await Effect.runPromise(generateInstallationToken());
  return token;
}

/** `gh` errors carry the forge's refusal on stderr, not always in `message`. */
function errorText(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const stderr = (cause as { stderr?: unknown }).stderr;
  return typeof stderr === 'string' && stderr.trim() ? `${cause.message}\n${stderr}` : cause.message;
}

/**
 * Author the verdict as the App's bot (`<app-slug>[bot]`) when the GitHub App is
 * installed. The bot is never the PR author, so GitHub accepts the review that
 * it refuses from the operator's own account. A token failure is not a verdict
 * failure: fall through to the plain `gh` identity and let the marker fallback
 * catch a refusal.
 */
async function appTokenEnv(deps: PostReviewVerdictDeps): Promise<NodeJS.ProcessEnv | undefined> {
  try {
    if (!(deps.isAppConfigured ?? isGitHubAppConfigured)()) return undefined;
    const token = await (deps.getAppToken ?? defaultAppToken)();
    return token ? { ...process.env, GH_TOKEN: token } : undefined;
  } catch (cause) {
    console.warn(`[pr-review-verdict] GitHub App token unavailable, posting as the gh CLI user: ${errorText(cause)}`);
    return undefined;
  }
}

function markerFor(verdict: ReviewVerdict): MarkerVerdict | null {
  if (verdict === 'approve') return 'APPROVED';
  if (verdict === 'request-changes') return 'CHANGES_REQUESTED';
  return null;
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
    const runGh = deps.runGh ?? defaultRunGh;
    const env = await appTokenEnv(deps);
    const options: RunGhOptions = env ? { env } : {};
    try {
      await runGh([
        'pr', 'review', String(ref.number), '--repo', repo, flag, '--body', input.body,
      ], options);
    } catch (cause) {
      const message = errorText(cause);
      const marker = markerFor(input.verdict);
      // GitHub: "Can not request changes on your own pull request". On a
      // single-account install that is every verdict, so the verdict becomes a
      // marker comment that `pr-facts` reads back as the review decision.
      if (!marker || !/own pull request/i.test(message)) {
        return { posted: false, reason: `gh pr review failed: ${message}` };
      }
      try {
        await runGh([
          'pr', 'comment', String(ref.number), '--repo', repo,
          '--body', `${formatVerdictMarker(marker, reviewedHeadSha(facts.headSha, input.reviewedHead))}\n\n${input.body}`,
        ], options);
      } catch (commentCause) {
        return {
          posted: false,
          reason: `gh pr review refused a self-review and the fallback comment failed: ${errorText(commentCause)}`,
        };
      }
      return { posted: true, forge: 'github', url: facts.url, verdict: input.verdict, via: 'comment' };
    }
    return { posted: true, forge: 'github', url: facts.url, verdict: input.verdict, via: 'review' };
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
