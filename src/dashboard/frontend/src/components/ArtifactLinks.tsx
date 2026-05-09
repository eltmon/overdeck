import { List, Loader2, ScrollText } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';

interface ArtifactLinksProps {
  issueId: string;
  hasPlan: boolean;
  hasBeads: boolean;
  beadsCount?: number;  // Deprecated — use hasBeads
  onViewBeads: () => void;
  onViewVBrief: () => void;
  variant: 'card' | 'inspector';
}

export function ArtifactLinks({
  issueId,
  hasPlan,
  hasBeads,
  onViewBeads,
  onViewVBrief,
  variant,
}: ArtifactLinksProps) {
  const queryClient = useQueryClient();
  const needsTaskGeneration = hasPlan && !hasBeads;

  const generateTasksMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/generate-tasks`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || (body?.errors?.[0] ?? 'Failed to generate tasks'));
      }
      return body as { success: true; created: string[]; count: number };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['planning-state', issueId] });
      await refreshDashboardState(queryClient);
    },
  });

  const handleTasksClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (needsTaskGeneration) {
      if (!generateTasksMutation.isPending) generateTasksMutation.mutate();
    } else {
      onViewBeads();
    }
  };

  const handleVBriefClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onViewVBrief();
  };

  if (variant === 'inspector') {
    return (
      <>
        {(hasBeads || needsTaskGeneration) && (
          <button
            onClick={() => handleTasksClick()}
            disabled={generateTasksMutation.isPending}
            className="flex items-center gap-1.5 text-primary hover:text-primary/80 disabled:opacity-50"
          >
            {generateTasksMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <List className="w-3 h-3" />
            )}
            <span>{needsTaskGeneration ? 'Generate Tasks' : 'Tasks'}</span>
          </button>
        )}
        {hasPlan && (
          <button
            onClick={() => handleVBriefClick()}
            className="flex items-center gap-1.5 text-signal-review hover:text-signal-review/80"
          >
            <ScrollText className="w-3 h-3" />
            <span>vBRIEF</span>
          </button>
        )}
      </>
    );
  }

  // card variant — compact chips
  return (
    <>
      {(hasBeads || needsTaskGeneration) && (
        <button
          onClick={(e) => handleTasksClick(e)}
          disabled={generateTasksMutation.isPending}
          className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-50 ${
            needsTaskGeneration
              ? 'text-destructive hover:text-destructive/80 font-medium'
              : 'text-success hover:text-success/80'
          }`}
          title={needsTaskGeneration ? 'Generate beads from vBRIEF plan' : 'Tasks'}
        >
          {generateTasksMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <List className="w-3.5 h-3.5" />
          )}
          {needsTaskGeneration ? 'Generate Tasks' : 'Tasks'}
        </button>
      )}
      {hasPlan && (
        <button
          onClick={(e) => handleVBriefClick(e)}
          className="flex items-center gap-1 text-xs text-success hover:text-success/80 transition-colors"
          title="vBRIEF"
        >
          <ScrollText className="w-3.5 h-3.5" />
          vBRIEF
        </button>
      )}
    </>
  );
}
