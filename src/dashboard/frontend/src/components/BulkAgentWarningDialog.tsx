import type { Issue, Agent } from '../types';
import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';

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
    <Modal
      title="Active Agents Warning"
      size="narrow"
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={formStyles.button}>
          Cancel
        </button>
        <button type="button" onClick={onProceed} className={formStyles.primaryButton}>
          Proceed (Skip Issues with Agents)
        </button>
      </>}
    >
      <div className={`${formStyles.content} space-y-4`}>
        <p className={formStyles.text}>
          {issuesWithAgents.length} selected {issuesWithAgents.length === 1 ? 'issue has' : 'issues have'} active agents:
        </p>
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {issuesWithAgents.map(({ issue, runningAgents }) => (
            <li key={issue.identifier} className="flex items-center justify-between rounded-lg border border-border/70 bg-card px-3 py-2">
              <span className="text-sm font-medium text-foreground">{issue.identifier}</span>
              <span className="text-xs text-muted-foreground">
                {runningAgents.map(a => a.id).join(', ')}
              </span>
            </li>
          ))}
        </ul>
        <p className={formStyles.hint}>
          Proceeding will skip these issues. Only issues without active agents will be closed out.
        </p>
      </div>
    </Modal>
  );
}
