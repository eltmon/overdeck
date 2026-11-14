/**
 * PAN-5218: after a PR merges, file one follow-up issue per advisory review
 * delivery (today: CodeRabbit) whose findings the work agent never settled.
 *
 * CodeRabbit is advisory and never gates a merge, so its findings can arrive
 * minutes before the merge train lands the PR. The relay journals each
 * delivery with its PR, review and threads (`coderabbit-feedback.ts`); this
 * module reads those candidates back after the merge and decides per thread
 * (`advisory-followup-settlement.ts`).
 *
 * - Two triggers, one filer: the post-merge lifecycle's never-awaited kick
 *   right after `merge.completed`, and the deacon-lite patrol for what the kick
 *   missed (`advisory-followup-patrol.ts`). Both run after the forge said
 *   "merged", so nothing here can delay or gate a merge.
 * - One issue per delivery key: the journal (`feedback.followup_filed`) plus a
 *   body search for the key before creating. A failed search files nothing:
 *   creating blind could file the issue twice.
 * - Issues are created only through the GitHub App, so they are authored by its
 *   bot. Any failure raises Needs-you with every unsettled finding and journals
 *   `feedback.followup_failed`, which closes the key for both triggers.
 * - A delivery that is settled, or was journaled before PAN-5218 (`legacy`), is
 *   remembered in this process so the patrol never re-reads the forge for it.
 *
 * Never throws into its caller.
 */
import {
  fetchPullRequestSettlementFacts,
  type GhRunner,
} from './coderabbit-ingestion.js';
import {
  advisoryCandidates,
  advisoryDeliveryData,
  closingOutcomeFor,
  settleAdvisoryDelivery,
  type AdvisoryDeliveryData,
  type AdvisorySettlement,
  type AdvisoryThreadRecord,
  type PullRequestSettlementFacts,
} from './advisory-followup-settlement.js';
import { surfaceIssueFeedbackNeedsYou } from './feedback-target.js';
import { appendPipelineEntry, readPipelineJournal, type PipelineJournalEntry } from './pipeline-journal.js';
import { runGh } from '../github-quota/run-gh.js';
import { createIssueWithApp, isGitHubAppConfigured, isIntegrationPermissionError } from '../github-app.js';
import { resolveGitHubIssue } from '../tracker-utils.js';

const SOURCE = 'advisory-followup';
export const ADVISORY_FOLLOWUP_TITLE_PREFIX = 'CodeRabbit follow-up for';

export interface AdvisoryFollowupDeps {
  readJournal?: (workspacePath: string) => PipelineJournalEntry[];
  fetchFacts?: (repo: string, prNumber: number, since: string) => Promise<PullRequestSettlementFacts>;
  resolveTrackerRepo?: (issueId: string) => { owner: string; repo: string } | null;
  appConfigured?: () => boolean;
  findExisting?: (owner: string, repo: string, dedupKey: string) => Promise<{ number: number; url: string } | null>;
  createIssue?: (owner: string, repo: string, input: { title: string; body: string }) => Promise<{ number: number; url: string }>;
  appendEntry?: typeof appendPipelineEntry;
  surfaceNeedsYou?: (issueId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
  log?: (line: string) => void;
}

export type AdvisoryFollowupOutcome =
  | { dedupKey: string; outcome: Exclude<AdvisorySettlement['outcome'], 'unsettled'> }
  | { dedupKey: string; outcome: 'filed'; issueNumber: number; issueUrl: string; recovered: boolean }
  | { dedupKey: string; outcome: 'needs-you'; reason: string };

const inFlight = new Map<string, Promise<AdvisoryFollowupOutcome[]>>();
/** Keys decided `settled` or `legacy` in this process: terminal after the merge, so never re-read. */
const resolvedKeys = new Set<string>();

/** True when this process already decided the key needs no follow-up. */
export function isAdvisoryKeyResolvedInProcess(dedupKey: string): boolean {
  return resolvedKeys.has(dedupKey);
}

/** Test hook: forget in-flight runs and remembered decisions. */
export function __resetAdvisoryFollowupsForTests(): void {
  inFlight.clear();
  resolvedKeys.clear();
}

const ghRunner: GhRunner = async (args) => (await runGh(args, { caller: 'other', timeout: 20_000 })).stdout;

async function defaultFindExisting(owner: string, repo: string, dedupKey: string): Promise<{ number: number; url: string } | null> {
  const stdout = await ghRunner([
    'api', '-X', 'GET', 'search/issues',
    '-f', `q=repo:${owner}/${repo} is:issue in:body "${dedupKey}"`,
    '--jq', `[.items[] | select(.title | startswith("${ADVISORY_FOLLOWUP_TITLE_PREFIX}"))][0] // empty | {number, url: .html_url}`,
  ]);
  if (!stdout.trim()) return null;
  const hit = JSON.parse(stdout) as { number?: number; url?: string };
  return typeof hit.number === 'number' ? { number: hit.number, url: hit.url ?? '' } : null;
}

function defaultResolveTrackerRepo(issueId: string): { owner: string; repo: string } | null {
  const resolved = resolveGitHubIssue(issueId);
  return resolved.isGitHub ? { owner: resolved.owner, repo: resolved.repo } : null;
}

/** One finding line: location, severity, title and link, as the follow-up body and Needs-you list it. */
export function advisoryFindingLine(thread: AdvisoryThreadRecord): string {
  const location = thread.path ? `${thread.path}${thread.line != null ? `:${thread.line}` : ''}` : 'general';
  const severity = thread.severity ? ` [${thread.severity}]` : '';
  return `- \`${location}\`${severity} ${thread.title}${thread.url ? ` (${thread.url})` : ''}`;
}

export function advisoryFollowupTitle(issueId: string, data: AdvisoryDeliveryData, count: number): string {
  return `${ADVISORY_FOLLOWUP_TITLE_PREFIX} ${issueId} (PR #${data.prNumber}): ${count} unsettled finding(s)`;
}

export function advisoryFollowupBody(
  issueId: string,
  settlement: Extract<AdvisorySettlement, { outcome: 'unsettled' }>,
): string {
  const { data } = settlement;
  const prUrl = `https://github.com/${data.repo}/pull/${data.prNumber}`;
  const relayedTo = data.agentId ?? `no work agent: ${data.reason ?? 'unknown'}`;
  return [
    `CodeRabbit posted these findings on PR #${data.prNumber} (${prUrl}), review ${data.reviewUrl ?? `${prUrl}#pullrequestreview-${data.reviewId}`}.`,
    `They were relayed to ${relayedTo} at ${settlement.at}, and the PR merged before they were settled:`,
    'no reply on the thread, no later commit to the file, and no re-review request naming the thread.',
    '',
    'CodeRabbit is advisory. For each finding, fix it or close it with a reason.',
    '',
    ...settlement.threads.map(advisoryFindingLine),
    '',
    `Parent issue: ${issueId}. Delivery key: \`${data.dedupKey}\`.`,
  ].join('\n');
}

/** Never throws. One in-flight run per issue in this process; a concurrent call joins it. */
export function fileAdvisoryFollowups(
  issueId: string,
  workspacePath: string,
  deps: AdvisoryFollowupDeps = {},
): Promise<AdvisoryFollowupOutcome[]> {
  const id = issueId.toUpperCase();
  const running = inFlight.get(id);
  if (running) return running;
  const log = deps.log ?? ((line: string) => console.log(line));
  const run = runFiler(id, workspacePath, deps, log)
    .catch((err): AdvisoryFollowupOutcome[] => {
      log(`[${SOURCE}] ${id}: follow-up run failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    })
    .finally(() => inFlight.delete(id));
  inFlight.set(id, run);
  return run;
}

async function runFiler(
  issueId: string,
  workspacePath: string,
  deps: AdvisoryFollowupDeps,
  log: (line: string) => void,
): Promise<AdvisoryFollowupOutcome[]> {
  const entries = (deps.readJournal ?? readPipelineJournal)(workspacePath);
  const outcomes: AdvisoryFollowupOutcome[] = [];
  const open: Array<{ candidate: PipelineJournalEntry; data: AdvisoryDeliveryData }> = [];
  for (const candidate of advisoryCandidates(entries)) {
    const dedupKey = String(candidate.data?.dedupKey);
    const closed = closingOutcomeFor(entries, dedupKey);
    if (closed) { outcomes.push({ dedupKey, outcome: closed }); continue; }
    if (resolvedKeys.has(dedupKey)) { outcomes.push({ dedupKey, outcome: 'settled' }); continue; }
    const data = advisoryDeliveryData(candidate);
    if (!data) {
      resolvedKeys.add(dedupKey);
      log(`[${SOURCE}] ${issueId}: ${dedupKey} was journaled before PAN-5218 and carries no threads; no follow-up`);
      outcomes.push({ dedupKey, outcome: 'legacy' });
      continue;
    }
    open.push({ candidate, data });
  }
  if (open.length === 0) return outcomes;

  // One forge read per PR, from the earliest delivery on it.
  const byPr = new Map<string, typeof open>();
  for (const item of open) {
    const key = `${item.data.repo}#${item.data.prNumber}`;
    byPr.set(key, [...(byPr.get(key) ?? []), item]);
  }
  const fetchFacts = deps.fetchFacts
    ?? ((repo: string, pr: number, since: string) => fetchPullRequestSettlementFacts(repo, pr, since, ghRunner));
  for (const group of byPr.values()) {
    const since = group.map((item) => item.candidate.at).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    const facts = await fetchFacts(group[0].data.repo, group[0].data.prNumber, since);
    for (const { candidate } of group) {
      const settlement = settleAdvisoryDelivery(candidate, entries, facts);
      if (settlement.outcome !== 'unsettled') {
        if (settlement.outcome === 'settled' || settlement.outcome === 'legacy') resolvedKeys.add(settlement.dedupKey);
        log(`[${SOURCE}] ${issueId}: ${settlement.dedupKey} ${settlement.outcome}; no follow-up`);
        outcomes.push({ dedupKey: settlement.dedupKey, outcome: settlement.outcome });
        continue;
      }
      outcomes.push(await fileOne(issueId, workspacePath, settlement, deps, log));
    }
  }
  return outcomes;
}

async function fileOne(
  issueId: string,
  workspacePath: string,
  settlement: Extract<AdvisorySettlement, { outcome: 'unsettled' }>,
  deps: AdvisoryFollowupDeps,
  log: (line: string) => void,
): Promise<AdvisoryFollowupOutcome> {
  const { data, dedupKey, threads } = settlement;
  const append = deps.appendEntry ?? appendPipelineEntry;

  const fail = async (cause: string): Promise<AdvisoryFollowupOutcome> => {
    const reason = `CodeRabbit left ${threads.length} unsettled finding(s) on PR #${data.prNumber} after it merged, `
      + `and no follow-up issue was filed: ${cause}`;
    try {
      await (deps.surfaceNeedsYou ?? surfaceIssueFeedbackNeedsYou)(issueId, reason, {
        specialist: 'coderabbit', prNumber: data.prNumber, dedupKey, findings: threads.map(advisoryFindingLine),
      });
    } catch (err) {
      log(`[${SOURCE}] ${issueId}: could not raise Needs-you: ${err instanceof Error ? err.message : String(err)}`);
    }
    append(workspacePath, {
      type: 'feedback.followup_failed', issueId, source: SOURCE, data: { kind: data.kind, dedupKey, reason: cause },
    });
    log(`[${SOURCE}] ${issueId}: ${reason}`);
    return { dedupKey, outcome: 'needs-you', reason };
  };

  const tracker = (deps.resolveTrackerRepo ?? defaultResolveTrackerRepo)(issueId);
  if (!tracker) return fail(`${issueId} is not tracked on GitHub, so open one by hand from the findings below`);
  if (!(deps.appConfigured ?? isGitHubAppConfigured)()) {
    return fail('no GitHub App is configured, so open one by hand from the findings below');
  }

  const filed = (issue: { number: number; url: string }, recovered: boolean): AdvisoryFollowupOutcome => {
    append(workspacePath, {
      type: 'feedback.followup_filed',
      issueId,
      source: SOURCE,
      data: {
        kind: data.kind, dedupKey, issueNumber: issue.number, issueUrl: issue.url,
        repo: data.repo, prNumber: data.prNumber, threads: threads.length, ...(recovered ? { recovered: true } : {}),
      },
    });
    log(`[${SOURCE}] ${issueId}: ${recovered ? 'found' : 'filed'} follow-up #${issue.number} for ${threads.length} unsettled CodeRabbit finding(s)`);
    return { dedupKey, outcome: 'filed', issueNumber: issue.number, issueUrl: issue.url, recovered };
  };

  let existing: { number: number; url: string } | null;
  try {
    existing = await (deps.findExisting ?? defaultFindExisting)(tracker.owner, tracker.repo, dedupKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`the duplicate check on ${tracker.owner}/${tracker.repo} failed (${message}), so nothing was created `
      + 'rather than risk a second issue; open one by hand from the findings below');
  }
  if (existing) return filed(existing, true);

  try {
    const issue = await (deps.createIssue ?? createIssueWithApp)(tracker.owner, tracker.repo, {
      title: advisoryFollowupTitle(issueId, data, threads.length),
      body: advisoryFollowupBody(issueId, settlement),
    });
    return filed(issue, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isIntegrationPermissionError(message)) {
      return fail(`the GitHub App cannot create issues on ${tracker.owner}/${tracker.repo}: grant it Issues: Read and write `
        + 'in its GitHub App settings and accept the new permission on the installation');
    }
    return fail(`creating it on ${tracker.owner}/${tracker.repo} failed: ${message}`);
  }
}
