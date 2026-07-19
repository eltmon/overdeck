import { useEffect, useMemo, useRef, useState } from 'react';

import { selectAgents, selectIssues, useDashboardStore } from '../lib/store';
import type { Agent, Issue } from '../types';
import {
  AgentPillPopoverRow,
  isRunningAgentStatus,
  relativeTime,
} from './AgentPillPopoverRow';

export function RunningAgentsPill() {
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const runningAgents = useMemo(
    () => agents
      .filter((agent) => isRunningAgentStatus(agent.status))
      .sort((a, b) => {
        const aTime = Date.parse(a.lastActivity ?? a.startedAt);
        const bTime = Date.parse(b.lastActivity ?? b.startedAt);
        return bTime - aTime;
      }),
    [agents],
  );

  const issueTitleById = useMemo(
    () => new Map(issues.map((issue) => [issue.identifier.toUpperCase(), issue.title])),
    [issues],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (runningAgents.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${runningAgents.length} running agent${runningAgents.length === 1 ? '' : 's'} — click to view`}
        data-testid="running-agents-pill"
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {runningAgents.length} agent{runningAgents.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div
          data-testid="running-agents-popover"
          className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-lg border border-border bg-card p-3 shadow-xl"
        >
          <div className="mb-2 text-xs font-semibold text-foreground">
            {runningAgents.length} running now
          </div>
          <div className="max-h-64 overflow-y-auto">
            {runningAgents.map((agent) => {
              const activityAt = agent.lastActivity ?? agent.startedAt;
              return (
                <AgentPillPopoverRow
                  key={agent.id}
                  agent={agent}
                  title={agent.issueId ? issueTitleById.get(agent.issueId.toUpperCase()) : undefined}
                  contextLine={`${agent.model} · ${relativeTime(activityAt, Date.now())}`}
                  onNavigate={() => setOpen(false)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
