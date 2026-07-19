import type { Agent } from '../types';

const RUNNING_AGENT_STATUSES = new Set(['running', 'active', 'starting', 'thinking', 'working']);
const SYSTEM_AGENT_ROLES = new Set(['flywheel', 'sequencer', 'knowledge']);

export function isRunningAgentStatus(status: Agent['status']): boolean {
  return RUNNING_AGENT_STATUSES.has(status);
}

export function describeAgentStop(agent: Agent): string {
  if (agent.pausedReason) return `paused: ${agent.pausedReason}`;
  if (agent.paused) return 'paused';
  if (agent.troubled) {
    const failures = agent.consecutiveFailures;
    return `troubled (${failures} failure${failures === 1 ? '' : 's'})`;
  }
  if (agent.stoppedByUser) return 'stopped by operator';
  return 'stopped cleanly';
}

function navigateToPath(path: string): void {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateToIssue(issueId: string): void {
  navigateToPath(`/issues/${encodeURIComponent(issueId)}`);
}

export function relativeTime(iso: string, now: number): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '—';

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface AgentPillPopoverRowProps {
  agent: Agent;
  title?: string;
  contextLine: string;
  onNavigate?: () => void;
}

export function AgentPillPopoverRow({
  agent,
  title,
  contextLine,
  onNavigate,
}: AgentPillPopoverRowProps) {
  const issueId = agent.issueId ?? agent.id;

  return (
    <button
      type="button"
      className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
      onClick={() => {
        if (agent.issueId && !SYSTEM_AGENT_ROLES.has(agent.role ?? '')) navigateToIssue(agent.issueId);
        else navigateToPath('/agents');
        onNavigate?.();
      }}
    >
      <span className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="shrink-0 font-mono text-[11px] text-foreground">{issueId}</span>
        {title && (
          <span className="min-w-0 flex-1 truncate text-foreground" title={title}>
            {title}
          </span>
        )}
        {agent.role && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{agent.role}</span>
        )}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{contextLine}</span>
    </button>
  );
}
