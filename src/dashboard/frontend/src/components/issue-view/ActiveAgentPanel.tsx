import { getHarness } from '@overdeck/contracts';
import type { AgentSnapshot } from '@overdeck/contracts';

import VerbBadge, { type VerbBadgeProps } from '../primitives/VerbBadge';
import { getFriendlyModelName } from '../../lib/dashboard-utils';
import { isAwaitingInput } from '../../lib/pendingInput';
import {
  useDashboardStore,
  selectAgentById,
  selectPendingPermissionAgentIds,
} from '../../lib/store';
import { cn } from '../../lib/utils';
import { ACTIVE_AGENT_PANEL_SECTIONS } from './inventory';
import { TellComposer } from './TellComposer';
import { useIssueActions } from '../IssueActionMenu/useIssueActions';
import { IssueActionDialogHost } from '../IssueActionMenu';
import { RESUME_WHAT_IT_DOES } from '../../lib/resumeOutcome';

/**
 * PAN-2908 C-DETAIL: the gray "stream excerpt" box and its "No recent stream
 * output" state are deleted, not re-skinned — the conversation pane (rich
 * transcript) is the live view now. This panel keeps the agent header/meta,
 * the resume affordance, and the tell form.
 */

function stuckHours(agent: AgentSnapshot, now: Date): number {
  const since = agent.firstFailureInRunAt ?? agent.lastFailureAt ?? agent.lastActivity ?? agent.startedAt;
  if (!since) return 0;
  const sinceTime = new Date(since).getTime();
  if (Number.isNaN(sinceTime)) return 0;
  return Math.max(0, Math.floor((now.getTime() - sinceTime) / 3_600_000));
}

function isTerminalStatus(status: AgentSnapshot['status']): boolean {
  return status === 'unknown';
}

function verbBadgeForAgent(
  agent: AgentSnapshot,
  pendingPermissionAgentIds?: ReadonlySet<string>,
): VerbBadgeProps {
  if (agent.troubled || agent.status === 'error' || isTerminalStatus(agent.status)) {
    return { variant: 'STUCK · Nh', hours: stuckHours(agent, new Date()), className: 'text-[9px]' };
  }
  if (isAwaitingInput(agent, pendingPermissionAgentIds)) return { variant: 'INPUT', className: 'text-[9px]' };
  if (agent.status === 'stopped') return { variant: 'STOPPED', className: 'text-[9px]' };
  if (agent.role === 'plan') return { variant: 'PLANNING', className: 'text-[9px]' };
  if (agent.role === 'review' || agent.role === 'test') return { variant: 'REVIEW RUNNING', className: 'text-[9px]' };
  if (agent.role === 'ship') return { variant: 'SHIP RUNNING', className: 'text-[9px]' };
  if (agent.role === 'strike') return { variant: 'STRIKE RUNNING', className: 'text-[9px]' };
  return { variant: 'WORK RUNNING', className: 'text-[9px]' };
}

function formatSpend(cost: number | undefined) {
  if (cost === undefined) return 'loading';
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(3)}`;
  return '$0';
}

export interface ActiveAgentPanelProps {
  agentId: string;
  density?: 'console' | 'cockpit' | 'rail';
  className?: string;
  title?: string;
}

export function ActiveAgentPanel({
  agentId,
  density = 'console',
  className,
  title,
}: ActiveAgentPanelProps) {
  const agent = useDashboardStore(selectAgentById(agentId));
  const pendingPermissionAgentIds = useDashboardStore(selectPendingPermissionAgentIds);
  // PAN-2975: one resume path — the registry's resumeSession action (same
  // endpoint, same outcome toast, shared copy) instead of a bespoke canned call.
  const issueActions = useIssueActions(agent?.issueId ?? '');
  const resumeView = agent?.issueId ? issueActions.all.find((view) => view.action.key === 'resumeSession') : undefined;

  const sectionId = density === 'console' ? 'active-agent' : undefined;

  const fallback = (
    <section
      id={sectionId}
      data-testid="active-agent-panel"
      data-section={ACTIVE_AGENT_PANEL_SECTIONS[0]}
      className={cn(
        'rounded-[var(--radius)] border border-border bg-card p-[14px]',
        className,
      )}
    >
      <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {title ?? 'Active Agent'}
      </div>
      <div className="rounded-[10px] border border-border bg-background/45 px-[12px] py-[14px] text-[12px] text-muted-foreground">
        No active agent.
      </div>
    </section>
  );

  if (!agent || isTerminalStatus(agent.status)) {
    return fallback;
  }

  const meta = `${getFriendlyModelName(agent.model)} · ${getHarness(agent)} · spend ${formatSpend(agent.costSoFar)}`;
  const isEffectivelyLive = agent.status === 'running' || agent.status === 'starting';

  return (
    <section
      id={sectionId}
      data-testid="active-agent-panel"
      data-section={ACTIVE_AGENT_PANEL_SECTIONS[0]}
      className={cn(
        'rounded-[var(--radius)] border border-border bg-card p-[14px]',
        density === 'console' && 'border-l-[3px] border-l-signal-review',
        className,
      )}
    >
      <div
        className="flex items-start justify-between gap-[12px]"
        data-section={ACTIVE_AGENT_PANEL_SECTIONS[1]}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-[8px]">
            <h3 className="truncate font-mono text-[13px] font-semibold leading-none text-foreground">
              {agent.id}
            </h3>
            <VerbBadge {...verbBadgeForAgent(agent, pendingPermissionAgentIds)} />
          </div>
          <div className="mt-[6px] text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {agent.status === 'stopped'
              ? 'Stopped Agent — send a message to resume'
              : (title ?? 'Active Agent')}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] leading-none text-muted-foreground">
          {meta}
        </div>
      </div>

      {!isEffectivelyLive && resumeView?.enabled && (
        <button
          type="button"
          data-testid="active-agent-panel-resume"
          data-section={ACTIVE_AGENT_PANEL_SECTIONS[2]}
          title={RESUME_WHAT_IT_DOES}
          className="mt-[10px] w-full rounded-[var(--radius-sm)] border border-primary/30 bg-primary/10 px-[12px] py-[8px] text-[12px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => resumeView.invoke()}
          disabled={resumeView.isPending}
        >
          {resumeView.isPending ? 'Resuming…' : `▶ Resume session · ${agent.issueId}`}
        </button>
      )}
      {agent?.issueId && <IssueActionDialogHost issueId={agent.issueId} actions={issueActions} />}

      <TellComposer agentId={agent.id} isEffectivelyLive={isEffectivelyLive} />
    </section>
  );
}
