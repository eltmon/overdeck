import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FlywheelStats } from '@panctl/contracts';
import { listInWindow, type FlywheelSubstrateBug } from '../../../lib/database/flywheel-substrate-bugs-db.js';
import { computeSubstrateBugWeight } from '../../../lib/flywheel-bug-weight.js';
import { parseAffectedCriteria } from '../../../lib/flywheel-affected-criteria.js';
import { computeFlywheelStats, parseFlywheelStatsWindow } from './flywheel-telemetry.js';
import { derivePipelineRunStatsInputs } from './pipeline-run-metrics.js';

const execFileAsync = promisify(execFile);
const ISSUE_DETAILS_CONCURRENCY = 5;

export interface FlywheelIssueDetails {
  body: string;
  labels: readonly string[];
}

export interface FlywheelSubstrateBugWeightEntry {
  issueId: string;
  criteria: number[];
  weight: number;
  reason: string;
}

export interface FlywheelSubstrateBugWeightsPayload {
  window: string;
  generatedAt: string;
  weights: FlywheelSubstrateBugWeightEntry[];
}

export interface FlywheelSubstrateBugWeightsDeps {
  now?: () => Date;
  listBugs?: (since: string, until: string) => readonly FlywheelSubstrateBug[];
  fetchIssueDetails?: (issueId: string) => Promise<FlywheelIssueDetails>;
  computeStats?: (window: string, generatedAt: Date, since: string, until: string) => Promise<FlywheelStats>;
}

interface GhIssueViewPayload {
  body?: unknown;
  labels?: unknown;
}

function issueNumber(issueId: string): string {
  const match = issueId.match(/^(?:[A-Z]+-)?(\d+)$/);
  return match?.[1] ?? issueId;
}

function parseLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels.flatMap((label) => {
    if (typeof label === 'string') return [label];
    if (typeof label === 'object' && label !== null && 'name' in label && typeof label.name === 'string') {
      return [label.name];
    }
    return [];
  });
}

export async function fetchGitHubIssueDetails(issueId: string): Promise<FlywheelIssueDetails> {
  const { stdout } = await execFileAsync('gh', ['issue', 'view', issueNumber(issueId), '--json', 'body,labels'], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as GhIssueViewPayload;
  return {
    body: typeof parsed.body === 'string' ? parsed.body : '',
    labels: parseLabels(parsed.labels),
  };
}

async function computeStatsForWindow(window: string, generatedAt: Date, since: string, until: string): Promise<FlywheelStats> {
  return computeFlywheelStats(window, {
    generatedAt,
    ...await derivePipelineRunStatsInputs(since, until),
  });
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function computeFlywheelSubstrateBugWeights(
  window = '30d',
  deps: FlywheelSubstrateBugWeightsDeps = {},
): Promise<FlywheelSubstrateBugWeightsPayload> {
  const generatedAtDate = (deps.now ?? (() => new Date()))();
  const parsedWindow = parseFlywheelStatsWindow(window);
  const since = new Date(generatedAtDate.getTime() - parsedWindow.ms).toISOString();
  const generatedAt = generatedAtDate.toISOString();
  const stats = await (deps.computeStats ?? computeStatsForWindow)(parsedWindow.input, generatedAtDate, since, generatedAt);
  const bugs = (deps.listBugs ?? listInWindow)(since, generatedAt).filter((bug) => bug.status === 'open');
  const fetchIssueDetails = deps.fetchIssueDetails ?? fetchGitHubIssueDetails;
  const weights = await mapWithConcurrency(bugs, ISSUE_DETAILS_CONCURRENCY, async (bug) => {
    const issue = await fetchIssueDetails(bug.issueId);
    const criteria = parseAffectedCriteria(issue.body, issue.labels);
    const { weight, reason } = computeSubstrateBugWeight(criteria, stats);
    return { issueId: bug.issueId, criteria, weight, reason } satisfies FlywheelSubstrateBugWeightEntry;
  });

  weights.sort((left, right) => right.weight - left.weight || left.issueId.localeCompare(right.issueId));

  return { window: parsedWindow.input, generatedAt, weights };
}
