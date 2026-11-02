/**
 * MobileIssueSheet — the read-only full-screen issue sheet (PAN-4661).
 *
 * D-4661-9 Full screen: the shell hides its header and tab bar while this is
 *     open. D-4661-10 fields, in order: Back + identifier, title, then Phase,
 *     State, Needs you (only when `issueNeedsOperator`), Project, Pull
 *     request, Agent, Labels, Updated, and an Open-in-tracker link.
 * D-4661-11 It does not reuse `IssueActionMenu`, `AutoMergeToggle`,
 *     `IssuePeek`, the desktop `IssueRow` or the issue drawer — none of
 *     those are read-only.
 */
import { useConnectionState } from '../../lib/connectionState';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { derivedForIssue, firstAgentByIssueId, getPipelineIssuePhase } from '../../lib/pipeline-state';
import { useDashboardStore, selectAgents, selectIssues } from '../../lib/store';
import type { Agent, Issue } from '../../types';
import { PHASE_LABELS } from '../primitives/PhaseHeader';
import { issueNeedsOperator, NeedsYouMark } from './MobilePipeline';

function agentSummary(agent: Agent): string {
  return [agent.role, agent.model, agent.status].filter(Boolean).join(' · ');
}

function Header({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border pt-[env(safe-area-inset-top)]">
      <button type="button" onClick={onBack} className="min-h-11 min-w-11 text-sm text-foreground">
        Back
      </button>
      <span className="font-mono text-xs text-muted-foreground">{issueId}</span>
    </div>
  );
}

export function MobileIssueSheet({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  const issues = useDashboardStore(selectIssues) as Issue[];
  const derivedByIssueId = useDashboardStore((s) => s.derivedIssueStateByIssueId);
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const hasSnapshot = useConnectionState((s) => s.hasSnapshot);

  const issue = issues.find((i) => i.identifier.toLowerCase() === issueId.toLowerCase());

  if (!hasSnapshot) {
    return (
      <section aria-label="Issue" className="px-4 pb-[env(safe-area-inset-bottom)]">
        <Header issueId={issueId} onBack={onBack} />
        <p className="px-0 py-6 text-sm text-muted-foreground">Loading issue…</p>
      </section>
    );
  }

  if (!issue) {
    return (
      <section aria-label="Issue" className="px-4 pb-[env(safe-area-inset-bottom)]">
        <Header issueId={issueId} onBack={onBack} />
        <p className="px-0 py-6 text-sm text-muted-foreground">This issue is not in the pipeline.</p>
      </section>
    );
  }

  const derived = derivedForIssue(derivedByIssueId, issue);
  const agent = firstAgentByIssueId(agents).get(issue.identifier.toLowerCase());
  const phase = getPipelineIssuePhase(derived, issue);
  const needsYou = issueNeedsOperator(derived, agent);

  return (
    <section aria-label="Issue" className="px-4 pb-[env(safe-area-inset-bottom)]">
      <Header issueId={issue.identifier} onBack={onBack} />
      <h2 className="mt-3 break-words text-base font-medium">{issue.title}</h2>
      <dl className="mt-3 space-y-3">
        <div>
          <dt className="text-xs text-muted-foreground">Phase</dt>
          <dd className="break-words text-sm">{PHASE_LABELS[phase]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">State</dt>
          <dd className="break-words text-sm">{derived?.state ?? '—'}</dd>
        </div>
        {needsYou && (
          <div>
            <dt className="text-xs text-muted-foreground">Needs you</dt>
            <dd className="break-words text-sm">
              <NeedsYouMark />
            </dd>
          </div>
        )}
        {issue.project && (
          <div>
            <dt className="text-xs text-muted-foreground">Project</dt>
            <dd className="break-words text-sm">{issue.project.name}</dd>
          </div>
        )}
        {derived?.pr && (
          <div>
            <dt className="text-xs text-muted-foreground">Pull request</dt>
            <dd className="break-words text-sm">{`#${derived.pr.number} · checks ${derived.pr.checks} · ${derived.pr.reviewState}`}</dd>
          </div>
        )}
        {agent && (
          <div>
            <dt className="text-xs text-muted-foreground">Agent</dt>
            <dd className="break-words text-sm">{agentSummary(agent)}</dd>
          </div>
        )}
        {issue.labels.length > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">Labels</dt>
            <dd className="break-words text-sm">{issue.labels.join(', ')}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Updated</dt>
          <dd className="break-words text-sm">{formatRelativeTime(issue.updatedAt, new Date())}</dd>
        </div>
      </dl>
      {issue.url && (
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex min-h-11 min-w-11 items-center text-sm text-foreground underline"
        >
          Open in tracker
        </a>
      )}
    </section>
  );
}
