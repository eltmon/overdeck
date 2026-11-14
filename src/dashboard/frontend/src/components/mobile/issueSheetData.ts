/** Pure data helpers for the issue sheet (PAN-5219 WI-5 to WI-9). No React. */
import {
  PHONE_ISSUE_EVENT_LABELS,
  type DerivedIssueState,
  type DerivedPrState,
  type DirectoryEntry,
  type DirectoryEntryState,
  type PhoneIssueEvent,
  type PrReviewState,
} from '@overdeck/contracts';

import { classifyDashboardAgent } from '../../lib/agent-classifier';
import type { Agent } from '../../types';
import type { IssueCheckRunsResponse, IssueCostData } from '../CommandDeck/ZoneCOverviewTabs/queries';

/** D-5: same local calendar day as `now` shows a time; otherwise a date and time. Null for an unparsable `at`. */
export function formatEventTime(at: string, now: Date): string | null {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** D-4/D-5: the "What happened" line for a notification's event. */
export function eventLine(
  event: { kind: PhoneIssueEvent; at: string | null },
  prNumber: number | null,
  now: Date,
): string {
  const label = event.kind === 'merge.completed' && prNumber !== null
    ? `Merged PR #${prNumber}`
    : PHONE_ISSUE_EVENT_LABELS[event.kind];
  const time = event.at ? formatEventTime(event.at, now) : null;
  return time ? `${label} at ${time}` : label;
}

/** D-6: true when `value` is a live agent-directory response. */
export function isLiveDirectoryResponse(value: unknown): value is { entries: DirectoryEntry[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { entries?: unknown }).entries);
}

export const DIRECTORY_STATE_LABELS: Readonly<Record<DirectoryEntryState, string>> = {
  working: 'Live',
  idle: 'Idle',
  blocked: 'Waiting for you',
  done: 'Done',
  stopped: 'Stopped',
  unknown: 'Status not available',
};

export interface IssueAgentSummary {
  summary: string;
  status: string;
  lastActivityAt: string | null;
  more: number;
}

function latestStoreAgent(issueId: string, storeAgents: readonly Agent[]): Agent | null {
  const target = issueId.toLowerCase();
  const matches = storeAgents.filter((a) => a.issueId?.toLowerCase() === target);
  if (matches.length === 0) return null;
  return matches.reduce((best, a) => {
    const bestAt = Date.parse(best.lastActivity ?? best.startedAt);
    const at = Date.parse(a.lastActivity ?? a.startedAt);
    return at > bestAt ? a : best;
  });
}

function storeAgentSummary(agent: Agent, status: string): IssueAgentSummary {
  return {
    summary: [agent.role, agent.model, agent.harness ?? agent.runtime].filter(Boolean).join(' · '),
    status,
    lastActivityAt: agent.lastActivity ?? null,
    more: 0,
  };
}

/** D-6: the agent row for `issueId`, or null when no agent is known anywhere. */
export function pickIssueAgent(
  issueId: string,
  directory: readonly DirectoryEntry[] | null,
  storeAgents: readonly Agent[],
  nowMs: number,
): IssueAgentSummary | null {
  if (directory) {
    const target = issueId.toLowerCase();
    const matches = directory.filter((entry) => entry.kind === 'agent' && entry.issueId?.toLowerCase() === target);
    if (matches.length > 0) {
      // Latest lastActivityAt first; null sorts last; a stable sort keeps response order on ties.
      const [best] = [...matches].sort((a, b) => {
        const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : -Infinity;
        const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : -Infinity;
        return bt - at;
      });
      return {
        summary: [best!.role, best!.model, best!.harness].filter(Boolean).join(' · '),
        status: DIRECTORY_STATE_LABELS[best!.state],
        lastActivityAt: best!.lastActivityAt,
        more: matches.length - 1,
      };
    }
    const fallback = latestStoreAgent(issueId, storeAgents);
    return fallback ? storeAgentSummary(fallback, 'Stopped') : null;
  }

  const fallback = latestStoreAgent(issueId, storeAgents);
  if (!fallback) return null;
  const classification = classifyDashboardAgent(
    { ...fallback, issueId: fallback.issueId ?? issueId } as Parameters<typeof classifyDashboardAgent>[0],
    nowMs,
  );
  return storeAgentSummary(fallback, classification === 'active' ? 'Live' : 'Stopped');
}

/** D-7: true when `value` has the one field the headline needs; never throws. */
export function isIssueCostData(value: unknown): value is IssueCostData {
  return typeof value === 'object' && value !== null && typeof (value as { totalCost?: unknown }).totalCost === 'number';
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** D-7: the headline total, preferring the resolved figure. */
export function headlineCost(data: IssueCostData): number {
  return data.resolvedTotalCost ?? data.totalCost;
}

/** D-7: up to 4 non-zero stages by cost descending, joined with " · ", plus "+N more"; null when every stage is zero or there are none. */
export function stageCostLine(byStage: Record<string, { cost: number; tokens: number }> | undefined): string | null {
  if (!byStage) return null;
  const stages = Object.entries(byStage)
    .filter(([, { cost }]) => cost > 0)
    .sort(([, a], [, b]) => b.cost - a.cost);
  if (stages.length === 0) return null;
  const shown = stages.slice(0, 4).map(([stage, { cost }]) => `${stage} ${formatUsd(cost)}`);
  const more = stages.length - shown.length;
  return more > 0 ? `${shown.join(' · ')} · +${more} more` : shown.join(' · ');
}

/** D-8: true when `value` has a numeric check-runs summary; never throws. */
export function isCheckRunsResponse(value: unknown): value is IssueCheckRunsResponse {
  if (typeof value !== 'object' || value === null) return false;
  const summary = (value as { summary?: unknown }).summary;
  if (typeof summary !== 'object' || summary === null) return false;
  const s = summary as Record<string, unknown>;
  return typeof s.total === 'number' && typeof s.passed === 'number' && typeof s.failed === 'number'
    && typeof s.running === 'number' && typeof s.pending === 'number';
}

export const REVIEW_LABELS: Readonly<Record<PrReviewState, string>> = {
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  'review-requested': 'Review requested',
  commented: 'Commented',
  none: 'No review yet',
};

/** D-8: the PR state label, or null when a PR is known only from check-runs. */
export function prStateLabel(derived: DerivedIssueState | undefined): string | null {
  if (!derived?.pr) return null;
  if (derived.pr.merged || derived.state === 'merged') return 'Merged';
  if (derived.state === 'closed') return 'Closed';
  return 'Open';
}

const CHECKS_FALLBACK_LABELS: Record<DerivedPrState['checks'], string> = {
  green: 'Checks passed',
  red: 'Checks failed',
  pending: 'Checks running',
};

export interface ChecksDisplay {
  text: string;
  /** The checks page to link to, only when the counts came from check-runs. */
  href: string | null;
}

/** D-8: the checks row, preferring a valid check-runs summary over `derivedPr.checks`. */
export function checksText(checkRuns: IssueCheckRunsResponse | null, derivedPr: DerivedPrState | undefined): ChecksDisplay {
  if (checkRuns) {
    const { summary } = checkRuns;
    if (summary.total === 0) return { text: 'No checks reported', href: null };
    const prUrl = derivedPr?.url ?? checkRuns.pr?.url ?? null;
    return {
      text: `${summary.passed} passed · ${summary.failed} failed · ${summary.running + summary.pending} running`,
      href: prUrl ? `${prUrl}/checks` : null,
    };
  }
  if (derivedPr) return { text: CHECKS_FALLBACK_LABELS[derivedPr.checks], href: null };
  return { text: 'Checks not available', href: null };
}

/** D-9: true when `text` is long enough to start collapsed (jsdom cannot measure overflow). */
export function shouldCollapseDescription(text: string): boolean {
  return text.split('\n').length > 4 || text.length > 280;
}
