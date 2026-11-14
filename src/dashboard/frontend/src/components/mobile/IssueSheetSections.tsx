/** Sections of the issue sheet moved out of MobileIssueSheet.tsx to keep it small (PAN-5219 WI-5 to WI-8). */
import { useQuery } from '@tanstack/react-query';
import type { DerivedIssueState, DirectoryEntry } from '@overdeck/contracts';

import { formatRelativeTime } from '../../lib/formatRelativeTime';
import type { Agent } from '../../types';
import type { IssueCheckRunsResponse, IssueCostData } from '../CommandDeck/ZoneCOverviewTabs/queries';
import {
  checksText,
  formatUsd,
  headlineCost,
  isCheckRunsResponse,
  isIssueCostData,
  isLiveDirectoryResponse,
  pickIssueAgent,
  prStateLabel,
  REVIEW_LABELS,
  stageCostLine,
} from './issueSheetData';

const LINK_CLASS = 'inline-flex min-h-11 min-w-11 items-center underline';

async function fetchCheckRuns(issueId: string): Promise<IssueCheckRunsResponse> {
  const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/check-runs`);
  if (!res.ok) throw new Error(`check-runs read failed: ${res.status}`);
  const body: unknown = await res.json();
  if (!isCheckRunsResponse(body)) throw new Error('check-runs read returned a malformed body');
  return body;
}

export function PrChecksSection({ issueId, derived }: { issueId: string; derived: DerivedIssueState | undefined }) {
  const query = useQuery({
    queryKey: ['mobile-issue-check-runs', issueId],
    queryFn: () => fetchCheckRuns(issueId),
    retry: false,
    refetchInterval: (q) => (q.state.status === 'error' ? false : 60_000),
  });
  const checkRuns = query.isSuccess ? query.data : null;
  const derivedPr = derived?.pr;
  const prUrl = derivedPr?.url ?? checkRuns?.pr?.url ?? null;
  const prNumber = derivedPr?.number ?? checkRuns?.pr?.number ?? null;
  if (prUrl === null || prNumber === null) {
    return (
      <div>
        <dt className="text-xs text-muted-foreground">Pull request</dt>
        <dd className="break-words text-sm">No pull request</dd>
      </div>
    );
  }
  const state = prStateLabel(derived);
  const review = derivedPr ? REVIEW_LABELS[derivedPr.reviewState] : null;
  const checks = checksText(checkRuns, derivedPr);
  return (
    <>
      <div>
        <dt className="text-xs text-muted-foreground">Pull request</dt>
        <dd className="break-words text-sm">
          <a href={prUrl} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            #{prNumber}
          </a>
          {state && ` · ${state}`}
          {review && ` · ${review}`}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Checks</dt>
        <dd className="break-words text-sm">
          {checks.href ? <a href={checks.href} target="_blank" rel="noreferrer" className={LINK_CLASS}>{checks.text}</a> : checks.text}
        </dd>
      </div>
    </>
  );
}

async function fetchIssueCosts(issueId: string): Promise<IssueCostData> {
  const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/costs`);
  if (!res.ok) throw new Error(`issue costs read failed: ${res.status}`);
  const body: unknown = await res.json();
  if (!isIssueCostData(body)) throw new Error('issue costs read returned a malformed body');
  return body;
}

export function CostSection({ issueId }: { issueId: string }) {
  const query = useQuery({
    queryKey: ['mobile-issue-costs', issueId],
    queryFn: () => fetchIssueCosts(issueId),
    retry: false,
    refetchInterval: (q) => (q.state.status === 'error' ? false : 30_000),
  });
  const headline = query.data
    ? headlineCost(query.data) === 0 ? 'No spend recorded' : formatUsd(headlineCost(query.data))
    : query.isError ? 'Cost not available' : 'Loading…';
  const stageLine = query.data ? stageCostLine(query.data.byStage) : null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">Cost</dt>
      <dd className="break-words text-sm">
        {headline}
        {stageLine && (
          <>
            <br />
            <span className="text-xs text-muted-foreground">{stageLine}</span>
          </>
        )}
      </dd>
    </div>
  );
}

async function fetchLiveDirectory(): Promise<DirectoryEntry[]> {
  const res = await fetch('/api/agent-directory?scope=live');
  if (!res.ok) throw new Error(`agent directory read failed: ${res.status}`);
  const body: unknown = await res.json();
  if (!isLiveDirectoryResponse(body)) throw new Error('agent directory read returned a malformed body');
  return body.entries;
}

export function AgentRow({ issueId, storeAgents }: { issueId: string; storeAgents: readonly Agent[] }) {
  const query = useQuery({
    queryKey: ['mobile-issue-agents-live'],
    queryFn: fetchLiveDirectory,
    retry: false,
    refetchInterval: (q) => (q.state.status === 'error' ? false : 15_000),
  });
  const picked = pickIssueAgent(issueId, query.isSuccess ? query.data : null, storeAgents, Date.now());
  if (!picked) {
    return (
      <div>
        <dt className="text-xs text-muted-foreground">Agent</dt>
        <dd className="break-words text-sm">No agent</dd>
      </div>
    );
  }
  const activeSuffix = picked.lastActivityAt ? ` · active ${formatRelativeTime(picked.lastActivityAt, new Date())}` : '';
  const moreSuffix = picked.more > 0 ? ` (+${picked.more} more)` : '';
  return (
    <div>
      <dt className="text-xs text-muted-foreground">Agent</dt>
      <dd className="break-words text-sm">
        {picked.summary}
        {moreSuffix}
        <br />
        <span className="text-muted-foreground">
          {picked.status}
          {activeSuffix}
        </span>
      </dd>
    </div>
  );
}

export function SheetHeader({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border pt-[env(safe-area-inset-top)]">
      <button type="button" onClick={onBack} className="min-h-11 min-w-11 text-sm text-foreground">
        Back
      </button>
      <span className="font-mono text-xs text-muted-foreground">{issueId}</span>
    </div>
  );
}

export function WhatHappened({ line }: { line: string }) {
  return (
    <p data-testid="mobile-issue-event" className="mt-3 break-words text-sm">
      <span className="block text-xs text-muted-foreground">What happened</span>
      {line}
    </p>
  );
}
