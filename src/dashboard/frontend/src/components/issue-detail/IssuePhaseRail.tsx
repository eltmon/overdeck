/**
 * PAN-2908 · C-DETAIL/C-VOCAB — the drawer's phase display, rebuilt on the
 * ONE shared rail. Replaces the legacy PhaseTimeline (Triaged → … → Merged
 * vocabulary) with the six-phase model every surface shares, driven by the
 * shared machine classifier. Legacy when-stamps are preserved as meta.
 */
import { useMemo } from 'react';
import { PhaseRail, type PhaseAgentInfo } from './PhaseRail';
import { derivePipelineState } from '../../lib/issuePipelineState';
import { phaseRailState, type Phase } from '../../lib/simple/phases';
import { useIssueData } from '../drawer/useDrawerData';
import { useDashboardStore } from '../../lib/store';
import type { Agent } from '../../types';

const ROLE_TO_PHASE: Record<string, Phase> = {
  plan: 'plan',
  work: 'work',
  review: 'review',
  test: 'test',
  ship: 'ship',
};

function agentPhaseInfo(agents: Agent[]): Partial<Record<Phase, PhaseAgentInfo>> {
  const out: Partial<Record<Phase, PhaseAgentInfo>> = {};
  for (const agent of agents) {
    const phase = ROLE_TO_PHASE[agent.role ?? ''];
    if (!phase) continue;
    const live = agent.status === 'running' || agent.status === 'starting' || agent.status === 'healthy';
    const existing = out[phase];
    // Prefer a live agent for the phase slot, but any agent marks the phase
    // as having a conversation to open.
    if (!existing || (live && !existing.live)) {
      out[phase] = {
        name: agent.id,
        model: agent.model,
        runtime: agent.runtime,
        live,
        hasConversation: true,
      };
    }
  }
  return out;
}

const LEGACY_WHEN_TO_PHASE: Record<string, Phase> = {
  planned: 'plan',
  implemented: 'work',
  reviewed: 'review',
  shipping: 'ship',
  merged: 'done',
};

export default function IssuePhaseRail({ issueId, onSelectPhase, activePhase }: { issueId?: string; onSelectPhase?: (phase: Phase) => void; activePhase?: Phase | null }) {
  const drawerIssueId = useDashboardStore((state) => state.drawer.issueId);
  const data = useIssueData(issueId ?? drawerIssueId);
  const { issue, agents, reviewStatus, phaseTimeline } = data ?? { issue: null, agents: [], reviewStatus: undefined, phaseTimeline: [] };

  const rail = useMemo(() => {
    const pipelineState = derivePipelineState({
      reviewStatus: reviewStatus ?? null,
      agent: agents.find((a) => !['stopped', 'failed', 'dead'].includes(a.status)) ?? agents[0] ?? null,
      hasPlan: issue?.hasPlan === true,
      hasTasks: issue?.hasTasks === true,
      issueCanonicalState: issue?.state ?? issue?.status ?? null,
      isMerged: reviewStatus?.mergeStatus === 'merged',
    });
    return phaseRailState(pipelineState);
  }, [issue, agents, reviewStatus]);

  const meta = useMemo(() => {
    const out: Partial<Record<Phase, string>> = { test: '—' };
    for (const step of phaseTimeline) {
      const phase = LEGACY_WHEN_TO_PHASE[step.id];
      if (phase) out[phase] = step.when;
    }
    return out;
  }, [phaseTimeline]);

  return (
    <div data-testid="drawer-phase-timeline">
      <PhaseRail rail={rail} agents={agentPhaseInfo(agents)} meta={meta} onSelectPhase={onSelectPhase} activePhase={activePhase} />
    </div>
  );
}
