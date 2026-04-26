import { AlertTriangle } from 'lucide-react';
import type { Issue, Agent } from '../types';

interface BulkAgentWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onProceed: () => void;
  issues: Issue[];
  agents: Agent[];
}

export function BulkAgentWarningDialog({ isOpen, onClose, onProceed, issues, agents }: BulkAgentWarningDialogProps) {
  if (!isOpen || issues.length === 0) return null;

  // Pre-index active agents by lowercased issueId for O(1) lookup — O(agents) instead of O(issues × agents)
  const activeAgentsByIssueId = new Map<string, Agent[]>();
  for (const agent of agents) {
    if (agent.issueId && agent.status !== 'dead' && agent.status !== 'stopped' && agent.status !== 'failed') {
      const key = agent.issueId.toLowerCase();
      const list = activeAgentsByIssueId.get(key) ?? [];
      list.push(agent);
      activeAgentsByIssueId.set(key, list);
    }
  }

  const issuesWithAgents = issues
    .map(issue => ({ issue, runningAgents: activeAgentsByIssueId.get(issue.identifier.toLowerCase()) ?? [] }))
    .filter(({ runningAgents }) => runningAgents.length > 0);

  if (issuesWithAgents.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 badge-bg-warning rounded-lg">
            <AlertTriangle className="w-6 h-6 text-warning-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Active Agents Warning
            </h3>
            <p className="text-foreground text-sm mb-4">
              {issuesWithAgents.length} selected {issuesWithAgents.length === 1 ? 'issue has' : 'issues have'} active agents:
            </p>
            <ul className="space-y-2 mb-6 max-h-48 overflow-y-auto">
              {issuesWithAgents.map(({ issue, runningAgents }) => (
                <li key={issue.identifier} className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2">
                  <span className="text-sm font-medium text-foreground">{issue.identifier}</span>
                  <span className="text-xs text-muted-foreground">
                    {runningAgents.map(a => a.id).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs mb-6">
              Proceeding will skip these issues. Only issues without active agents will be closed out.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={onProceed}
                className="px-4 py-2 bg-warning hover:bg-warning/90 text-foreground rounded-lg transition-colors text-sm"
              >
                Proceed (Skip Issues with Agents)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
