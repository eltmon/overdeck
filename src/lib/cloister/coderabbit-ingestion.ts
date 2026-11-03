/**
 * CodeRabbit review ingestion (PAN-2374).
 *
 * Quota invariant: CodeRabbit reviews PRs only sometimes. An empty finding
 * array means any of: no findings, quota miss, CodeRabbit absent, or fetch
 * error. Callers MUST treat all four identically — this module is advisory
 * and must never gate anything.
 *
 * PAN-4773: `fetchCodeRabbitReviewThreads` reads one review's inline threads,
 * which `coderabbit-feedback.ts` routes to the work agent. It never gates.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { lookupPullRequestNumberForBranch } from '../github-pr-lookup.js';

const execAsync = promisify(exec);

const CODERABBIT_BOT_LOGIN = 'coderabbitai[bot]';

export interface CodeRabbitFinding {
  path?: string;
  line?: number;
  body: string;
  url?: string;
}

async function resolveOwnerRepo(workspace: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execAsync('gh repo view --json owner,name', {
      cwd: workspace,
      encoding: 'utf-8',
      timeout: 15000,
    });
    const parsed = JSON.parse(stdout) as { owner?: { login?: string }; name?: string };
    const owner = parsed.owner?.login;
    const repo = parsed.name;
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

async function fetchFindingsFromReviews(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CodeRabbitFinding[]> {
  const { stdout } = await execAsync(
    `gh api "repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100"`,
    { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
  );
  const arr = JSON.parse(stdout) as Array<{
    user?: { login?: string } | null;
    body?: string | null;
    state?: string;
    html_url?: string;
  }>;
  return arr
    .filter(r => r.user?.login === CODERABBIT_BOT_LOGIN && r.state !== 'DISMISSED')
    .map(r => ({
      body: r.body ?? '',
      url: r.html_url,
    }));
}

async function fetchFindingsFromComments(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<CodeRabbitFinding[]> {
  const { stdout } = await execAsync(
    `gh api "repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100"`,
    { encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
  );
  const arr = JSON.parse(stdout) as Array<{
    user?: { login?: string } | null;
    body?: string | null;
    html_url?: string;
    path?: string;
    line?: number | null;
  }>;
  return arr
    .filter(c => c.user?.login === CODERABBIT_BOT_LOGIN)
    .map(c => ({
      path: c.path,
      line: typeof c.line === 'number' ? c.line : undefined,
      body: c.body ?? '',
      url: c.html_url,
    }));
}

export async function fetchCodeRabbitFindings(opts: {
  workspace: string;
  branch: string;
}): Promise<CodeRabbitFinding[]> {
  try {
    const ownerRepo = await resolveOwnerRepo(opts.workspace);
    if (!ownerRepo) return [];
    const { owner, repo } = ownerRepo;

    const prNumber = await lookupPullRequestNumberForBranch(owner, repo, opts.branch);
    if (!prNumber) return [];

    const [reviewFindings, commentFindings] = await Promise.all([
      fetchFindingsFromReviews(owner, repo, prNumber).catch(() => [] as CodeRabbitFinding[]),
      fetchFindingsFromComments(owner, repo, prNumber).catch(() => [] as CodeRabbitFinding[]),
    ]);

    return [...reviewFindings, ...commentFindings];
  } catch (err) {
    console.warn(
      `[coderabbit-ingestion] fetch failed — skipping: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/** One top-level inline thread of a CodeRabbit review (PAN-4773). */
export interface CodeRabbitThread {
  /** The thread's first comment id; replies go to `pulls/<n>/comments/<id>/replies`. */
  id: number;
  path?: string;
  line?: number;
  severity?: string;
  title: string;
  url?: string;
}

/**
 * Severity and title from a CodeRabbit inline comment body. The current format
 * (2026-11) opens with a bold header, an icon `<picture>` then the severity and
 * labels joined by ` · `:
 *   `**<picture><img …></picture> Minor** · **Functional Correctness** · **Quick win**`
 * and then the title on its own bold line. HTML comments and `<details>`
 * blocks (analysis scripts, agent prompts) are skipped. A body in no known
 * shape falls back to its first plain line.
 */
export function parseCodeRabbitComment(body: string): { severity?: string; title: string } {
  const visible = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<details>[\s\S]*?<\/details>/g, '');
  const plain = (text: string) => text.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  const lines = visible.split('\n').map((line) => line.trim()).filter((line) => plain(line));
  const headerIndex = lines.findIndex((line) => line.startsWith('**') && (line.includes('<picture>') || line.includes(' · ')));
  const severity = headerIndex >= 0 ? plain(lines[headerIndex].split(' · ')[0]) : undefined;
  const rest = lines.filter((_, index) => index !== headerIndex);
  const bold = rest.find((line) => /^\*\*[^*].*\*\*$/.test(line));
  const title = plain(bold ?? rest[0] ?? '') || '(no text)';
  return { ...(severity ? { severity } : {}), title: title.length > 160 ? `${title.slice(0, 157)}...` : title };
}

/** Runs `gh` with argv; resolves stdout. */
export type GhRunner = (args: string[]) => Promise<string>;

/**
 * The top-level inline threads of one CodeRabbit review: replies are left
 * out. An empty array means the review has no inline findings (a summary
 * review, or "no actionable comments"). A read failure rejects.
 *
 * The PR's comment list is read and filtered to the review, because the
 * per-review endpoint (`reviews/<id>/comments`) returns neither `line` nor
 * `in_reply_to_id`.
 */
export async function fetchCodeRabbitReviewThreads(
  repo: string,
  prNumber: number,
  reviewId: number,
  gh: GhRunner,
): Promise<CodeRabbitThread[]> {
  const stdout = await gh([
    'api', '--paginate', `repos/${repo}/pulls/${prNumber}/comments?per_page=100`,
    '--jq', `.[] | select(.pull_request_review_id == ${reviewId}) | {id, in_reply_to_id, body, path, line, original_line, html_url}`,
  ]);
  const rows = stdout.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as {
    id?: number;
    in_reply_to_id?: number | null;
    body?: string | null;
    path?: string;
    line?: number | null;
    original_line?: number | null;
    html_url?: string;
  });
  return rows
    .filter((row) => typeof row.id === 'number' && row.in_reply_to_id == null)
    .map((row) => {
      const line = row.line ?? row.original_line;
      return {
        id: row.id as number,
        ...(row.path ? { path: row.path } : {}),
        ...(typeof line === 'number' ? { line } : {}),
        ...parseCodeRabbitComment(row.body ?? ''),
        ...(row.html_url ? { url: row.html_url } : {}),
      };
    });
}
