import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { WorkspaceData } from '../ZoneCOverviewTabs/queries';
import type { UatAction } from '../uat-actions';

interface UatActionHandlerOptions {
  issueId: string;
  workspace?: WorkspaceData;
  queryClient: QueryClient;
}

function inferUatStackName(issueId: string, containers?: Record<string, unknown> | null): string {
  const firstContainerName = Object.keys(containers ?? {})[0];
  const match = firstContainerName?.match(/^(.+)-[a-z0-9_]+-\d+$/i);
  return match?.[1] ?? `overdeck-feature-${issueId.toLowerCase()}`;
}

async function fetchUatAction(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed: ${response.status}`);
  }
  return data;
}

export function createUatActionHandler({
  issueId,
  workspace,
  queryClient,
}: UatActionHandlerOptions): (action: UatAction) => Promise<void> {
  return async (action) => {
    try {
      switch (action.id) {
        case 'open-uat':
          if (!workspace?.frontendUrl) throw new Error('UAT frontend URL is not available');
          window.open(workspace.frontendUrl, '_blank', 'noopener,noreferrer');
          return;
        case 'open-api':
          if (!workspace?.apiUrl) throw new Error('UAT API URL is not available');
          window.open(workspace.apiUrl, '_blank', 'noopener,noreferrer');
          return;
        case 'copy-stack-name': {
          const stackName = inferUatStackName(issueId, workspace?.containers);
          await navigator.clipboard?.writeText(stackName);
          toast.success('Stack name copied');
          return;
        }
        case 'logs': {
          const data = await fetchUatAction(`/api/workspaces/${encodeURIComponent(issueId)}/stack-logs`);
          const logs = typeof data.logs === 'string' ? data.logs : '';
          await navigator.clipboard?.writeText(logs);
          toast.success('UAT logs copied');
          return;
        }
        case 'open-state-dir': {
          const data = await fetchUatAction(`/api/workspaces/${encodeURIComponent(issueId)}/state-dir`);
          const path = typeof data.path === 'string' ? data.path : '';
          if (!path) throw new Error('Workspace state directory is not available');
          await navigator.clipboard?.writeText(path);
          toast.success('State dir path copied');
          return;
        }
        case 'rebuild':
          await fetchUatAction(`/api/workspaces/${encodeURIComponent(issueId)}/rebuild-stack`, { method: 'POST' });
          toast.success(`Rebuilding UAT stack for ${issueId}`);
          break;
        case 'restart':
          await fetchUatAction(`/api/workspaces/${encodeURIComponent(issueId)}/stack/restart`, { method: 'POST' });
          toast.success(`Restarting UAT stack for ${issueId}`);
          break;
        case 'start':
          await fetchUatAction(`/api/workspaces/${encodeURIComponent(issueId)}/stack/start`, { method: 'POST' });
          toast.success(`Starting UAT stack for ${issueId}`);
          break;
        case 'stop':
          await fetchUatAction(`/api/workspaces/${encodeURIComponent(issueId)}/stack/stop`, { method: 'POST' });
          toast.success(`Stopping UAT stack for ${issueId}`);
          break;
        case 'reap': {
          const confirmed = window.confirm(
            `Reap workspace for ${issueId}?\n\nThis tears down the workspace through the standard workspace teardown path. It does not use deep-wipe.`,
          );
          if (!confirmed) {
            toast.info('Reap canceled');
            return;
          }
          await fetchUatAction(`/api/workspaces/${encodeURIComponent(issueId)}/reap`, { method: 'POST' });
          toast.success(`Reaping workspace for ${issueId}`);
          break;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      await queryClient.invalidateQueries({ queryKey: ['workspace-stack-health'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to run ${action.label}`);
    }
  };
}
