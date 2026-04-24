import { useState, useCallback } from 'react';
import { Play, X, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { useDashboardStore, selectAgentList } from '../lib/store';
import { Agent } from '../types';

interface RestartResult {
  issueId: string;
  success: boolean;
  error?: string;
}

export function StoppedAgentsBanner() {
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];

  /** Phases where an agent is considered actively in the pipeline.
   *  Stopped agents in these phases + not completed = likely crashed/orphaned. */
  const PIPELINE_PHASES = new Set([
    'planning', 'exploration', 'implementation', 'testing',
    'documentation', 'review', 'review-response', 'pre_push', 'post_push',
  ]);

  const RECENT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const recentStoppedAgents = agents.filter((a) => {
    if (a.status !== 'stopped') return false;
    // Exclude agents that finished their work normally
    if (a.runtimeState === 'completed') return false;
    if (a.resolution === 'completed' || a.resolution === 'done') return false;
    if (a.lifecycle?.isCompleted) return false;
    // Only care about agents that were in an active pipeline phase
    if (!a.agentPhase) return false;
    if (!PIPELINE_PHASES.has(a.agentPhase)) return false;
    // Only show recently-active agents — old state files are historical debris
    const lastActivity = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const startedAt = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const lastRelevant = Math.max(lastActivity, startedAt);
    return lastRelevant > 0 && Date.now() - lastRelevant < RECENT_MS;
  });

  // Deduplicate by issueId — keep only the most recent per issue
  const stoppedAgentsByIssue = new Map<string, Agent>();
  for (const agent of recentStoppedAgents) {
    const key = agent.issueId || agent.id;
    const existing = stoppedAgentsByIssue.get(key);
    if (!existing) {
      stoppedAgentsByIssue.set(key, agent);
      continue;
    }
    const existingTime = Math.max(
      existing.lastActivity ? new Date(existing.lastActivity).getTime() : 0,
      existing.startedAt ? new Date(existing.startedAt).getTime() : 0,
    );
    const agentTime = Math.max(
      agent.lastActivity ? new Date(agent.lastActivity).getTime() : 0,
      agent.startedAt ? new Date(agent.startedAt).getTime() : 0,
    );
    if (agentTime > existingTime) {
      stoppedAgentsByIssue.set(key, agent);
    }
  }
  const stoppedAgents = Array.from(stoppedAgentsByIssue.values());
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [results, setResults] = useState<RestartResult[] | null>(null);

  const handleRestartAll = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    setResults(null);

    const restartResults: RestartResult[] = [];

    for (const agent of stoppedAgents) {
      if (!agent.issueId) continue;
      try {
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueId: agent.issueId }),
        });
        if (res.ok) {
          restartResults.push({ issueId: agent.issueId, success: true });
        } else {
          const err = await res.json().catch(() => ({}));
          restartResults.push({ issueId: agent.issueId, success: false, error: err.error || res.statusText });
        }
      } catch (error) {
        restartResults.push({
          issueId: agent.issueId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    setResults(restartResults);
    setRestarting(false);
  }, [restarting, stoppedAgents]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleReset = useCallback(() => {
    setResults(null);
    setDismissed(false);
  }, []);

  if (dismissed || stoppedAgents.length === 0) {
    // Show a subtle "show again" button if dismissed and stopped agents exist
    if (dismissed && stoppedAgents.length > 0) {
      return (
        <div className="bg-surface-emphasis/40 border-b border-divider px-4 py-1 flex items-center gap-2 shrink-0">
          <span className="text-xs text-content-subtle">
            {stoppedAgents.length} agent{stoppedAgents.length > 1 ? 's' : ''} stopped
          </span>
          <button
            onClick={handleReset}
            className="text-xs text-primary hover:text-primary/80 underline"
          >
            Show
          </button>
        </div>
      );
    }
    return null;
  }

  const succeeded = results?.filter((r) => r.success).length ?? 0;
  const failed = results?.filter((r) => !r.success).length ?? 0;

  return (
    <div className="bg-warning/10 border-b-2 border-warning/40 px-4 py-3 flex items-start gap-3 shrink-0">
      <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-warning-foreground text-sm font-semibold">
          {stoppedAgents.length} agent{stoppedAgents.length > 1 ? 's' : ''} stopped
          {stoppedAgents.some((a) => a.lastActivity) && (
            <span className="font-normal text-warning-foreground/70 ml-1">
              (last active {Math.max(...stoppedAgents.map((a) =>
                a.lastActivity ? Date.now() - new Date(a.lastActivity).getTime() : 0
              )) / 60000 | 0}m ago)
            </span>
          )}
        </p>
        <p className="text-warning-foreground/80 text-xs mt-0.5">
          {stoppedAgents.map((a) => a.issueId || a.id).join(', ')}
        </p>

        {results && (
          <div className="mt-2 text-xs">
            {succeeded > 0 && (
              <span className="text-success flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {succeeded} restarted
              </span>
            )}
            {failed > 0 && (
              <span className="text-destructive flex items-center gap-1 mt-0.5">
                <X className="w-3 h-3" /> {failed} failed
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleRestartAll}
          disabled={restarting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {restarting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          {restarting ? 'Restarting...' : 'Restart All'}
        </button>
        <button
          onClick={handleDismiss}
          disabled={restarting}
          className="text-warning-foreground/60 hover:text-warning-foreground shrink-0 disabled:opacity-50"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
