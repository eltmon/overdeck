import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAlert, useConfirm } from '../DialogProvider';
import { useResetIssue } from '../../hooks/useResetIssue';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { COMMAND_DECK_SURFACE_REGISTRY } from '../../lib/commandDeckSurfaceRegistry';
import { isAgentRunningStatus } from '../../lib/pipeline-state';
import Button, { ButtonLink } from '../primitives/Button';
import type { Agent } from '../../types';
import { useDrawerData } from './useDrawerData';

void COMMAND_DECK_SURFACE_REGISTRY;

function isActiveAgent(agent: Agent) {
  return isAgentRunningStatus(agent.status);
}

async function responseError(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const data = JSON.parse(text) as { error?: string; message?: string };
    return data.error ?? data.message ?? fallback;
  } catch {
    return text.length < 200 ? text : fallback;
  }
}

export default function DrawerActionBar() {
  const { issue, agents, reviewStatus } = useDrawerData();
  const issueId = issue?.identifier;
  const activeAgent = agents.find(isActiveAgent);
  const confirm = useConfirm();
  const showAlert = useAlert();
  const queryClient = useQueryClient();
  const { confirmAndReset, isPending: isResetPending } = useResetIssue(issueId ?? '');

  const stopMutation = useMutation({
    mutationFn: async () => {
      if (!activeAgent) throw new Error('No active agent to stop');
      const response = await fetch(`/api/agents/${activeAgent.id}/stop`, { method: 'POST' });
      if (!response.ok) throw new Error(await responseError(response, 'Failed to stop agent'));
      return response.json() as Promise<{ success: boolean }>;
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to stop agent: ${error.message}`, variant: 'error' });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (!issueId) throw new Error('No issue selected');
      const response = await fetch(`/api/issues/${issueId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(await responseError(response, 'Failed to merge issue'));
      return response.json() as Promise<{ success: boolean }>;
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
    onError: (error: Error) => {
      showAlert({ message: `Failed to merge: ${error.message}`, variant: 'error' });
    },
  });

  const handleStop = async () => {
    if (!activeAgent) return;
    const confirmed = await confirm({
      title: 'Stop Agent',
      message: `Stop agent ${activeAgent.id}?`,
      variant: 'destructive',
      confirmLabel: 'Stop Agent',
    });
    if (confirmed) stopMutation.mutate();
  };

  const handleMerge = async () => {
    if (!issueId) return;
    const confirmed = await confirm({
      title: 'Merge to Main',
      message: `Merge ${issueId} to main?`,
      confirmLabel: 'Merge to main',
    });
    if (confirmed) mergeMutation.mutate();
  };

  function isSafeUrl(url: string | undefined): url is string {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  const prUrl = isSafeUrl(reviewStatus?.prUrl) ? reviewStatus.prUrl : isSafeUrl(issue?.url) ? issue.url : undefined;
  const canMerge = reviewStatus?.readyForMerge === true && reviewStatus.mergeStatus !== 'merged';

  return (
    <footer data-component="drawer-action-bar" data-testid="drawer-action-bar" className="flex items-center gap-[10px] border-t border-border bg-card/70 px-[22px] py-[12px]">
      <Button
        variant="ghost"
        data-testid="drawer-action-reset"
        disabled={!issueId || isResetPending}
        onClick={() => void confirmAndReset()}
      >
        {isResetPending ? 'Resetting…' : 'Reset'}
      </Button>
      <Button
        variant="ghost"
        data-testid="drawer-action-stop"
        disabled={!activeAgent || stopMutation.isPending}
        onClick={() => void handleStop()}
      >
        {stopMutation.isPending ? 'Stopping…' : 'Stop agent'}
      </Button>
      <div className="flex-1" />
      {prUrl ? (
        <ButtonLink
          variant="ghost"
          data-testid="drawer-action-view-pr"
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          View PR
        </ButtonLink>
      ) : null}
      <Button
        variant="primary"
        data-testid="drawer-action-merge"
        className="border-success/70 bg-success text-success-foreground hover:bg-success/90"
        disabled={!issueId || !canMerge || mergeMutation.isPending}
        onClick={() => void handleMerge()}
      >
        {mergeMutation.isPending ? 'Merging…' : 'Merge to main'}
      </Button>
    </footer>
  );
}
