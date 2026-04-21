import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, List, Loader2, ScrollText } from 'lucide-react';
import type { Issue } from '../types';
import { useAlert } from './DialogProvider';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

export interface PlanningState {
  hasPlan: boolean;
  hasBeads: boolean;
  beadsCount: number;
}

interface PlanningStateProps {
  planningState?: PlanningState;
}

interface PlanChipProps extends PlanningStateProps {
  issue: Issue;
  onPlan: (issue: Issue) => void;
  isPlanningActive?: boolean;
}

interface VBriefChipProps extends PlanningStateProps {
  issue: Issue;
  onViewVBrief?: (issue: Issue) => void;
}

interface TasksChipProps extends PlanningStateProps {
  issue: Issue;
  onViewBeads?: (issue: Issue) => void;
}

export function usePlanningState(issue: Issue) {
  return useQuery({
    queryKey: ['planning-state', issue.identifier],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/planning-state`);
      if (!res.ok) throw new Error('Failed to fetch planning state');
      return res.json() as Promise<PlanningState>;
    },
    enabled: !!issue.identifier,
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

export function PlanChip({ issue, onPlan, isPlanningActive = false, planningState }: PlanChipProps) {
  if (isPlanningActive) {
    return (
      <button
        data-testid={`action-watch-planning-${issue.identifier}`}
        onClick={(e) => {
          e.stopPropagation();
          onPlan(issue);
        }}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors animate-pulse"
        title="Watch Planning"
      >
        <Eye className="w-3.5 h-3.5" />
        <span>Watch Planning</span>
      </button>
    );
  }

  if (planningState) {
    return <PlanChipButton issue={issue} onPlan={onPlan} hasPlan={planningState.hasPlan} />;
  }

  return <PlanChipStateFetcher issue={issue} onPlan={onPlan} />;
}

function PlanChipStateFetcher({ issue, onPlan }: Pick<PlanChipProps, 'issue' | 'onPlan'>) {
  const planningStateQuery = usePlanningState(issue);
  const hasPlan = planningStateQuery.data?.hasPlan ?? false;
  return <PlanChipButton issue={issue} onPlan={onPlan} hasPlan={hasPlan} />;
}

function PlanChipButton({ issue, onPlan, hasPlan }: Pick<PlanChipProps, 'issue' | 'onPlan'> & { hasPlan: boolean }) {
  const planLabelExists = hasPlan || issue.labels?.some(l => l.toLowerCase() === 'planned');

  return (
    <button
      data-testid={`action-plan-${issue.identifier}`}
      onClick={(e) => {
        e.stopPropagation();
        onPlan(issue);
      }}
      className={`flex items-center gap-1 text-xs transition-colors ${
        planLabelExists
          ? 'text-success hover:text-success/80'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      title={planLabelExists ? 'See plan / continue planning' : 'Plan'}
    >
      <FileText className="w-3.5 h-3.5" />
      {planLabelExists ? 'See Plan' : 'Plan'}
    </button>
  );
}

export function VBriefChip({ issue, onViewVBrief, planningState }: VBriefChipProps) {
  if (planningState) {
    return <VBriefChipButton issue={issue} onViewVBrief={onViewVBrief} hasPlan={planningState.hasPlan} />;
  }

  return <VBriefChipStateFetcher issue={issue} onViewVBrief={onViewVBrief} />;
}

function VBriefChipStateFetcher({ issue, onViewVBrief }: VBriefChipProps) {
  const planningStateQuery = usePlanningState(issue);
  const hasPlan = planningStateQuery.data?.hasPlan ?? false;
  return <VBriefChipButton issue={issue} onViewVBrief={onViewVBrief} hasPlan={hasPlan} />;
}

function VBriefChipButton({ issue, onViewVBrief, hasPlan }: VBriefChipProps & { hasPlan: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onViewVBrief?.(issue);
      }}
      className={`flex items-center gap-1 text-xs transition-colors ${
        hasPlan
          ? 'text-success hover:text-success/80'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      title="vBRIEF"
    >
      <ScrollText className="w-3.5 h-3.5" />
      vBRIEF
    </button>
  );
}

export function TasksChip({ issue, onViewBeads, planningState }: TasksChipProps) {
  if (planningState) {
    return <TasksChipButton issue={issue} onViewBeads={onViewBeads} planningState={planningState} />;
  }

  return <TasksChipStateFetcher issue={issue} onViewBeads={onViewBeads} />;
}

function TasksChipStateFetcher({ issue, onViewBeads }: TasksChipProps) {
  const planningStateQuery = usePlanningState(issue);
  const planningState = planningStateQuery.data ?? { hasPlan: false, hasBeads: false, beadsCount: 0 };
  return <TasksChipButton issue={issue} onViewBeads={onViewBeads} planningState={planningState} />;
}

function TasksChipButton({ issue, onViewBeads, planningState }: TasksChipProps & { planningState: PlanningState }) {
  const queryClient = useQueryClient();
  const showAlert = useAlert();
  const hasPlan = planningState.hasPlan;
  const beadsCount = planningState.beadsCount;
  const needsTaskGeneration = hasPlan && beadsCount === 0;

  const generateTasksMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/generate-tasks`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || (body?.errors?.[0] ?? 'Failed to generate tasks'));
      }
      return body as { success: true; created: string[]; count: number };
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['planning-state', issue.identifier] });
      await refreshDashboardState(queryClient);
      void showAlert({ title: 'Tasks generated', message: `Created ${data.count} bead${data.count === 1 ? '' : 's'} from the vBRIEF plan.` });
    },
    onError: (err: Error) => {
      void showAlert({ title: 'Generate tasks failed', message: err.message, variant: 'error' });
    },
  });

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (needsTaskGeneration) {
          if (!generateTasksMutation.isPending) generateTasksMutation.mutate();
          return;
        }
        onViewBeads?.(issue);
      }}
      disabled={generateTasksMutation.isPending}
      className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-50 ${
        needsTaskGeneration
          ? 'text-destructive hover:text-destructive/80 font-medium'
          : beadsCount > 0
            ? 'text-success hover:text-success/80'
            : 'text-muted-foreground hover:text-foreground'
      }`}
      title={needsTaskGeneration ? 'Generate beads from vBRIEF plan' : 'Tasks'}
    >
      {generateTasksMutation.isPending
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : <List className="w-3.5 h-3.5" />}
      {needsTaskGeneration ? 'Generate Tasks' : 'Tasks'}
    </button>
  );
}
