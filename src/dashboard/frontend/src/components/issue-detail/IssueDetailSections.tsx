/**
 * PAN-5244 · the shared issue-drawer sections, in one leaf file.
 *
 * `IssueDetail` and the drawer's Details body both render these, so they live
 * here rather than in `IssueDetail.tsx`: importing them from `IssueDetail.tsx`
 * into a module that `IssueDetail.tsx` imports would be an import cycle.
 */
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GitBranch, Pause, Play } from 'lucide-react';

import { cn } from '../../lib/utils';
import { trackerIssueUrl } from '../../lib/issueLinks';
import { PickupGateControls } from '../backlog/PickupGateControls';
import { PanOpenInPicker } from '../PanOpenInPicker';
import type { WorkspaceInfo } from '../../lib/workspace-types';

/** Open the issue on its tracker in a new tab (the pickup controls' "view the write-up" link). */
export function openIssueOnTracker(issueId: string) {
  const href = trackerIssueUrl(issueId);
  if (href) window.open(href, '_blank', 'noopener,noreferrer');
}

export function PickupSection({ issueId }: { issueId: string }) {
  return (
    <section data-testid="drawer-pickup-section" className="rounded-[var(--radius)] border border-border bg-card p-[14px]">
      <PickupGateControls
        issueId={issueId}
        onOpenIssueBrowser={openIssueOnTracker}
      />
    </section>
  );
}

export function useDrawerWorkspace(issueId: string) {
  return useQuery<WorkspaceInfo | null>({
    queryKey: ['drawer-workspace', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}`);
      if (!res.ok) return null;
      return res.json() as Promise<WorkspaceInfo>;
    },
    retry: false,
  });
}

export function WorkspaceSection({ issueId }: { issueId: string }) {
  const { data: workspace } = useDrawerWorkspace(issueId);

  if (!workspace?.exists || !workspace.path) return null;

  return (
    <section data-testid="drawer-workspace-section" className="rounded-[var(--radius)] border border-border bg-card p-[14px]">
      <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Workspace</div>
      <div className="flex items-center justify-between gap-[12px]">
        <div className="min-w-0 truncate font-mono text-[11px] leading-[18px] text-muted-foreground" title={workspace.path}>
          {workspace.path}
        </div>
        <div className="shrink-0">
          <PanOpenInPicker openInCwd={workspace.path} />
        </div>
      </div>
      {workspace.git?.branch && (
        <div data-testid="drawer-workspace-branch" className="mt-[6px] truncate font-mono text-[11px] leading-[16px] text-muted-foreground" title={workspace.git.branch}>
          <GitBranch aria-hidden className="mr-[4px] inline h-3 w-3" />{workspace.git.branch}
        </div>
      )}
    </section>
  );
}

/** PAN-2908 C-DETAIL: the resources status facet for the always-visible right
 *  rail — workspace containers at a glance (names + health dots), same query
 *  as the Overview's Workspace section (shared cache, one fetch). PAN-5244:
 *  `variant="inline"` renders it inside a section under a "Containers" label. */
export function ResourcesFacet({ issueId, variant = 'rail' }: { issueId: string; variant?: 'rail' | 'inline' }) {
  const { data: workspace } = useDrawerWorkspace(issueId);
  const containers = Object.entries(workspace?.containers ?? {});
  if (!workspace?.exists) return null;

  return (
    <div
      data-section="DrawerResourcesFacet"
      className={variant === 'inline' ? 'mt-[8px] border-t border-border pt-[8px]' : 'shrink-0 border-l border-border bg-card/70 px-[14px] py-[10px]'}
    >
      <div className="mb-[6px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{variant === 'inline' ? 'Containers' : 'Resources'}</div>
      {containers.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {containers.map(([name, container]) => (
            <span
              key={name}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              title={`${name}: ${container.status ?? (container.running ? 'running' : 'stopped')}${container.uptime ? ` · up ${container.uptime}` : ''}`}
            >
              <span
                data-testid={`drawer-resource-dot-${name}`}
                className={cn(
                  'h-[7px] w-[7px] rounded-full',
                  container.running
                    ? container.health === 'unhealthy'
                      ? 'bg-destructive'
                      : 'bg-success'
                    : 'bg-muted-foreground/40',
                )}
              />
              <span className="font-mono">{name}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">Workspace on disk — no containers running.</div>
      )}
    </div>
  );
}

/** PAN-1779: a pause gate must be unmissable — amber banner with the full
 * reason and a one-click Unpause. Amber = a human must act (style guide). */
export function PausedBanner({ agents }: { agents: ReadonlyArray<{ id: string; paused?: boolean; pausedReason?: string }> }) {
  const paused = agents.filter((agent) => agent.paused === true);
  if (paused.length === 0) return null;

  const unpause = async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/unpause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to unpause agent');
      toast.success(`${agentId} unpaused — deacon resumes it on the next patrol`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unpause agent');
    }
  };

  return (
    <div data-testid="drawer-paused-banner" className="space-y-[6px] border-b border-border px-[22px] py-[10px]">
      {paused.map((agent) => (
        <div
          key={agent.id}
          className="flex items-center gap-[10px] rounded-[var(--radius-sm)] border px-[12px] py-[8px] badge-border-warning badge-bg-warning"
        >
          <Pause aria-hidden className="h-[14px] w-[14px] shrink-0 text-warning-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-warning-foreground">
              <span className="font-mono">{agent.id}</span> is paused
            </div>
            {agent.pausedReason && (
              <div className="truncate text-[12px] text-warning-foreground/75" title={agent.pausedReason}>
                {agent.pausedReason}
              </div>
            )}
          </div>
          <button
            type="button"
            data-testid={`drawer-unpause-${agent.id}`}
            onClick={() => void unpause(agent.id)}
            className="inline-flex shrink-0 items-center gap-[4px] rounded-[var(--radius-sm)] border px-[10px] py-[5px] text-[12px] font-medium badge-border-warning text-warning-foreground transition-colors hover:bg-warning/20"
          >
            <Play aria-hidden className="h-3 w-3" />Unpause
          </button>
        </div>
      ))}
    </div>
  );
}
