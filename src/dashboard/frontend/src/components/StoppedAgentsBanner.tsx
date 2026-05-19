import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Play, X, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { useDashboardStore, selectAgents } from '../lib/store';
import { Agent, type StartAgentResponse } from '../types';
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../lib/pending-codex-spawn';

interface RestartResult {
  issueId: string;
  success: boolean;
  error?: string;
}

export function StoppedAgentsBanner() {
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];

  // Show toast when an agent hits an API error (resolution transitions to 'api_error')
  const prevApiErrorAgentsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentApiErrorAgents = new Set(
      agents.filter(a => a.resolution === 'api_error').map(a => a.id),
    );
    for (const id of currentApiErrorAgents) {
      if (!prevApiErrorAgentsRef.current.has(id)) {
        const agent = agents.find(a => a.id === id);
        const label = agent?.issueId || id;
        toast.warning(`${label}: API error — auto-retry nudge sent`, { duration: 8000 });
      }
    }
    prevApiErrorAgentsRef.current = currentApiErrorAgents;
  }, [agents]);

  /** PAN-1048: roles that indicate active pipeline work. A stopped agent in
   *  one of these roles + not completed = likely crashed/orphaned. Standby
   *  (work agent with a live tmux session post-pan-done) is filtered separately
   *  by the lifecycle.hasLiveTmuxSession check below — those are intentional
   *  pauses, not crashes. */
  const PIPELINE_ROLES = new Set(['plan', 'work', 'review', 'test', 'ship']);

  const RECENT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const recentStoppedAgents = agents.filter((a) => {
    if (a.status !== 'stopped') return false;
    // Exclude agents that finished their work normally
    if (a.runtimeState === 'completed') return false;
    if (a.resolution === 'completed' || a.resolution === 'done') return false;
    if (a.lifecycle?.isCompleted) return false;
    // Exclude work agents in standby (live tmux session after pan done)
    if (a.role === 'work' && a.lifecycle?.hasLiveTmuxSession) return false;
    // Only care about agents that have a known pipeline role
    if (!a.role) return false;
    if (!PIPELINE_ROLES.has(a.role)) return false;
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
        const requestBody = { issueId: agent.issueId };
        let lastRequestBody: Record<string, unknown> = requestBody;
        let res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastRequestBody),
        });
        let data = await res.json().catch(() => ({})) as StartAgentResponse;
        if (res.status === 409 && data.requiresAcknowledgement) {
          const confirmed = window.confirm((data.guardrails?.warnings ?? []).map((warning) => `• ${warning.message}`).join('\n'));
          if (!confirmed) {
            restartResults.push({ issueId: agent.issueId, success: false, error: 'Agent start canceled' });
            continue;
          }
          lastRequestBody = { ...requestBody, guardrailAcknowledged: true };
          res = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastRequestBody),
          });
          data = await res.json().catch(() => ({})) as StartAgentResponse;
        }
        if (res.ok) {
          if (data.guardrails?.warnings?.length) {
            toast.success(`${agent.issueId}: started after acknowledging system health warnings`, { duration: 8000 });
          }
          restartResults.push({ issueId: agent.issueId, success: true });
        } else {
          if (isCodexBlockedResponse(res, data)) {
            setPendingCodexSpawn(lastRequestBody);
            restartResults.push({ issueId: agent.issueId, success: false, error: data.hint || data.error || 'Codex authentication expired — re-authenticate to continue' });
            continue;
          }
          restartResults.push({ issueId: agent.issueId, success: false, error: data.error || data.hint || res.statusText });
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
        <div className="bg-card/40 border-b border-border px-4 py-1 flex items-center gap-2 shrink-0" data-testid="stopped-agents-banner">
          <span className="text-xs text-muted-foreground">
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
    <div className="bg-warning/10 border-b border-warning/30 px-3 py-1 flex items-center gap-2 shrink-0" data-testid="stopped-agents-banner">
      <AlertTriangle className="w-3.5 h-3.5 text-warning-foreground shrink-0" />
      <span className="text-warning-foreground text-xs font-semibold">
        {stoppedAgents.length} stopped
      </span>
      <span className="text-warning-foreground/70 text-xs truncate">
        {stoppedAgents.map((a) => a.issueId || a.id).join(', ')}
        {stoppedAgents.some((a) => a.lastActivity) && (
          <span className="ml-1">
            ({Math.max(...stoppedAgents.map((a) =>
              a.lastActivity ? Date.now() - new Date(a.lastActivity).getTime() : 0
            )) / 60000 | 0}m ago)
          </span>
        )}
      </span>

      {results && (
        <span className="text-xs ml-1">
          {succeeded > 0 && (
            <span className="text-success inline-flex items-center gap-0.5">
              <CheckCircle className="w-3 h-3" /> {succeeded}
            </span>
          )}
          {failed > 0 && (
            <span className="text-destructive inline-flex items-center gap-0.5 ml-1">
              <X className="w-3 h-3" /> {failed}
            </span>
          )}
        </span>
      )}

      <div className="flex items-center gap-1.5 shrink-0 ml-auto">
        <button
          onClick={handleRestartAll}
          disabled={restarting}
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          data-testid="banner-restart-all"
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
          data-testid="banner-dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
