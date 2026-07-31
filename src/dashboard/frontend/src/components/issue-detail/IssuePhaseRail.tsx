/**
 * PAN-2908 · C-DETAIL/C-VOCAB — the drawer's phase display, rebuilt on the
 * ONE shared rail. Replaces the legacy PhaseTimeline (Triaged → … → Merged
 * vocabulary) with the six-phase model every surface shares, driven by the
 * shared machine classifier. Legacy when-stamps are preserved as meta.
 */
import { useEffect, useMemo, useState } from 'react';
import { PhaseRail, type PhaseAgentInfo, type PhaseMeta } from './PhaseRail';
import { derivePipelineState } from '../../lib/issuePipelineState';
import { phaseRailState, type Phase } from '../../lib/simple/phases';
import { useIssueData } from '../drawer/useDrawerData';
import { useDashboardStore } from '../../lib/store';
import type { Agent } from '../../types';
import type { ReviewStatusData } from '../CommandDeck/ZoneCOverviewTabs/queries';
import { deriveShip } from '../issue-view/derivations';
import { ShipProgress } from '../issue-view/ShipProgress';

const ROLE_TO_PHASE: Record<string, Phase> = {
  plan: 'plan',
  work: 'work',
  review: 'review',
  test: 'test',
  ship: 'ship',
};

function elapsedSeconds(agent: Agent, now: number, live: boolean): number | undefined {
  const started = Date.parse(agent.startedAt);
  if (!Number.isFinite(started)) return undefined;
  const ended = !live && agent.lastActivity ? Date.parse(agent.lastActivity) : now;
  if (!Number.isFinite(ended) || ended < started) return undefined;
  return Math.floor((ended - started) / 1000);
}

function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function agentPhaseInfo(agents: Agent[], now: number): Partial<Record<Phase, PhaseAgentInfo>> {
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
        startedAt: agent.startedAt,
        durationSeconds: elapsedSeconds(agent, now, live),
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
  const [now, setNow] = useState(() => Date.now());
  const hasLiveAgent = agents.some((agent) => agent.status === 'running' || agent.status === 'starting' || agent.status === 'healthy');

  useEffect(() => {
    if (!hasLiveAgent) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasLiveAgent]);

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

  const phaseAgents = useMemo(() => agentPhaseInfo(agents, now), [agents, now]);
  const meta = useMemo(() => {
    const dates: Partial<Record<Phase, string>> = {};
    for (const step of phaseTimeline) {
      const phase = LEGACY_WHEN_TO_PHASE[step.id];
      if (phase) dates[phase] = step.when;
    }

    const out: Partial<Record<Phase, string | PhaseMeta>> = {};
    for (const phase of Object.keys(rail) as Phase[]) {
      const state = rail[phase];
      const duration = formatDuration(phaseAgents[phase]?.durationSeconds);
      if (state === 'current') {
        out[phase] = `Live · ${duration ?? 'just started'}`;
      } else if (state === 'done') {
        out[phase] = [dates[phase] && dates[phase] !== '—' ? dates[phase] : 'Done', duration].filter(Boolean).join(' · ');
      }
    }
    if (reviewStatus?.testStatus === 'skipped') {
      out.test = {
        text: 'Skipped · no suite configured',
        href: 'https://overdeck.ai/configuration/projects',
        skipped: true,
      };
    }
    return out;
  }, [phaseAgents, phaseTimeline, rail, reviewStatus?.testStatus]);

  const ship = deriveShip(reviewStatus as ReviewStatusData | undefined);
  const showShipProgress = ship.status === 'queued' || ship.status === 'merging' || ship.status === 'verifying';

  return (
    <div data-testid="drawer-phase-timeline">
      <PhaseRail
        rail={rail}
        agents={phaseAgents}
        meta={meta}
        trailing={showShipProgress ? { ship: <ShipProgress ship={ship} compact /> } : undefined}
        onSelectPhase={onSelectPhase}
        activePhase={activePhase}
      />
    </div>
  );
}
