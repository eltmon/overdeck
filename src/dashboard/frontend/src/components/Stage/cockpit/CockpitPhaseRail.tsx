import { useMemo } from 'react';
import { useSharedTick } from '../../../lib/useSharedTick';
import { PHASES, phaseLabel, phaseRailState, type Phase, type PhaseStepState } from '../../../lib/simple/phases';
import type { PipelineState } from '../../../lib/issuePipelineState';
import { cn } from '../../../lib/utils';
import { ShipProgress } from '../../issue-view/ShipProgress';
import type { AgentRowModel, IssueShipModel } from '../../issue-view/types';

const ACCENT: Record<PhaseStepState, string> = {
  done: 'bg-success',
  current: 'bg-info',
  attention: 'bg-destructive',
  pending: 'bg-muted opacity-60',
};

const NAME_TONE: Record<PhaseStepState, string> = {
  done: 'text-success-foreground',
  current: 'text-info-foreground',
  attention: 'text-destructive-foreground',
  pending: 'text-muted-foreground',
};

function agentPhase(agent: AgentRowModel): Phase | null {
  if (agent.type === 'planning') return 'plan';
  if (agent.type === 'work' || agent.type === 'strike') return 'work';
  if (agent.type === 'review' || agent.type === 'reviewer') return 'review';
  if (agent.type === 'test') return 'test';
  if (agent.type === 'ship' || agent.type === 'merge') return 'ship';
  return null;
}

function preferredPhaseAgents(agents: AgentRowModel[]): Partial<Record<Phase, AgentRowModel>> {
  const result: Partial<Record<Phase, AgentRowModel>> = {};
  for (const agent of agents) {
    const phase = agentPhase(agent);
    if (!phase) continue;
    if (!result[phase] || (agent.active && !result[phase]?.active)) result[phase] = agent;
  }
  return result;
}

function durationSeconds(agent: AgentRowModel, nowMs: number): number | null {
  if (!agent.active) return agent.duration;
  const startedAt = Date.parse(agent.startedAt);
  if (!Number.isFinite(startedAt) || nowMs < startedAt) return agent.duration;
  return Math.floor((nowMs - startedAt) / 1000);
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatStartedAt(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fallbackMeta(state: PhaseStepState): string {
  if (state === 'done') return 'Completed';
  if (state === 'current') return 'Live';
  if (state === 'attention') return 'Needs attention';
  return 'Queued';
}

export function CockpitPhaseRail({
  pipelineState,
  agents,
  ship,
  testStatus,
  onSelectPhase,
}: {
  pipelineState: PipelineState;
  agents: AgentRowModel[];
  ship: IssueShipModel;
  testStatus?: string;
  onSelectPhase: (phase: Phase) => void;
}) {
  const now = useSharedTick();
  const rail = useMemo(() => phaseRailState(pipelineState), [pipelineState]);
  const phaseAgents = useMemo(() => preferredPhaseAgents(agents), [agents]);

  return (
    <section
      data-section="Pipeline Band"
      aria-label="Issue pipeline"
      className="grid auto-cols-fr grid-flow-col overflow-x-auto rounded-[var(--radius)] border border-border bg-card"
    >
      {PHASES.map((phase, index) => {
        const state = rail[phase];
        const agent = phaseAgents[phase];
        const duration = agent ? formatDuration(durationSeconds(agent, now.getTime())) : null;
        const startedAt = agent ? formatStartedAt(agent.startedAt) : null;
        const skipped = phase === 'test' && testStatus === 'skipped';
        const meta = skipped
          ? 'Skipped · no suite configured'
          : agent
            ? [agent.active ? 'Live' : fallbackMeta(state), duration].filter(Boolean).join(' · ')
            : fallbackMeta(state);

        return (
          <div
            key={phase}
            data-phase={phase}
            data-state={state}
            data-skipped={skipped || undefined}
            className={cn(
              'relative min-w-[132px] px-3 pb-2 pt-2.5',
              index > 0 && 'border-l border-border',
              skipped && 'border-dashed',
            )}
          >
            <span className={cn('absolute inset-x-0 top-0 h-0.5', skipped ? 'border-t-2 border-dashed border-muted-foreground/50' : ACCENT[state])} />
            <button
              type="button"
              onClick={() => onSelectPhase(phase)}
              className="block w-full min-w-0 text-left hover:text-foreground"
            >
              <span className={cn('flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em]', NAME_TONE[state])}>
                {agent?.active ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" /> : null}
                {phaseLabel(phase)}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{meta}</span>
              {agent ? (
                <>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-foreground">
                    {agent.label} · {agent.model}{agent.harness ? ` · ${agent.harness}` : ''}
                  </span>
                  {startedAt ? <time dateTime={agent.startedAt} className="mt-0.5 block truncate text-[10px] text-muted-foreground">Started {startedAt}</time> : null}
                </>
              ) : null}
            </button>
            {skipped ? (
              <a
                href="https://overdeck.ai/configuration/projects"
                className="mt-1 block text-[10px] text-muted-foreground hover:text-foreground hover:underline"
              >
                Configure tests
              </a>
            ) : null}
            {phase === 'ship' && ['queued', 'merging', 'verifying'].includes(ship.status) ? (
              <div className="mt-1.5"><ShipProgress ship={ship} compact /></div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
