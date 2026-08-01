import { SpecialistStrip, type SpecialistChip } from '../../issue-detail/SpecialistStrip';
import { ShipProgress } from '../../issue-view/ShipProgress';
import { StartAgentCta } from '../../issue-view/StartAgentCta';
import type { IssueViewModel } from '../../issue-view/types';
import { CockpitPill } from './CockpitCard';
import { HappenedFeed } from './HappenedFeed';
import { PickupGateCard } from './PickupGateCard';
import { StatusNarrative } from './StatusNarrative';

export interface IssueOverviewTabProps {
  issueId: string;
  model: IssueViewModel;
  state: 'live' | 'done' | 'pre-work';
  hasPlan: boolean;
  workRunning: boolean;
  mergedCommit?: string;
  reviewSummary?: string;
}

function ShipSurface({ model }: { model: IssueViewModel }) {
  return (
    <section data-section="Cost / Artifacts / Ship homes" aria-label="Ship progress" className="rounded-[var(--radius)] border border-border bg-card p-4">
      <ShipProgress ship={model.ship} />
    </section>
  );
}

/** Lifecycle summary, review outcomes, recent activity, and pickup gate. */
export function IssueOverviewTab({
  issueId,
  model,
  state,
  hasPlan,
  workRunning,
  mergedCommit,
  reviewSummary,
}: IssueOverviewTabProps) {
  if (state === 'pre-work') {
    return (
      <div className="space-y-3.5">
        <section data-testid="overview-pre-work" className="rounded-[var(--radius)] border border-border bg-card p-5">
          <h2 className="text-[16px] font-medium text-foreground">Start the first agent run</h2>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-5 text-muted-foreground">
            Overdeck will create the workspace, read the approved plan, and keep the agent session available here while it works.
          </p>
          <div className="mt-4"><StartAgentCta issueId={issueId} density="cockpit" /></div>
        </section>
        <ShipSurface model={model} />
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="space-y-3.5">
        <section data-testid="overview-done" className="rounded-[var(--radius)] border border-success/32 bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <CockpitPill tone="success">Done</CockpitPill>
            <h2 className="text-[16px] font-medium text-foreground">Merged to main</h2>
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            Merged commit <span className="font-mono text-foreground">{mergedCommit ?? 'unavailable'}</span>
          </div>
          <p className="mt-3 text-[12.5px] leading-5 text-foreground">
            {reviewSummary ?? 'Review and verification completed successfully.'}
          </p>
        </section>
        <ShipSurface model={model} />
      </div>
    );
  }

  const specialists: SpecialistChip[] = model.agents
    .filter((agent) => agent.type === 'reviewer')
    .map((agent) => ({
      id: agent.sessionId,
      name: `review.${agent.role ?? agent.label.toLowerCase()}`,
      status: agent.active ? 'running' : agent.verdict === 'changes_requested' || agent.status === 'error' ? 'failed' : 'done',
      verdict: agent.verdict === 'approved' ? 'APPROVED' : agent.verdict === 'changes_requested' ? 'CHANGES_REQUESTED' : null,
      lastLine: agent.verdict === 'approved' ? 'Approved' : agent.verdict === 'changes_requested' ? 'Changes requested' : agent.status,
      model: agent.model,
      hasConversation: false,
    }));

  return (
    <div data-testid="overview-live" className="space-y-3.5">
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Current state</h2>
        <StatusNarrative issueId={issueId} hasPlan={hasPlan} workRunning={workRunning} />
      </section>
      <SpecialistStrip specialists={specialists} />
      <HappenedFeed issueId={issueId} />
      <ShipSurface model={model} />
      <div data-section="PickupGateCard"><PickupGateCard issueId={issueId} /></div>
    </div>
  );
}
