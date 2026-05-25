import type { AgentStatus } from '@panctl/contracts';
import { ChevronDown, ChevronRight, ClipboardCopy } from 'lucide-react';
import { useState } from 'react';

import { classifyDashboardAgent } from '../lib/agent-classifier';
import { selectAgents, useDashboardStore } from '../lib/store';
import type { Agent } from '../types';

export function OrphanTestAgentsSurface() {
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const [expanded, setExpanded] = useState(false);

  const orphanAgents = agents.filter((agent) => {
    if (!agent.issueId) return false;
    return classifyDashboardAgent({
      issueId: agent.issueId,
      status: agent.status as AgentStatus,
      hasLiveTmuxSession: agent.hasLiveTmuxSession ?? agent.lifecycle?.hasLiveTmuxSession,
      lastActivity: agent.lastActivity,
      startedAt: agent.startedAt,
    }) === 'orphan_test';
  });

  if (orphanAgents.length === 0) return null;

  const copyWipeCommand = (issueId: string) => {
    void navigator.clipboard?.writeText(`pan wipe ${issueId}`);
  };

  return (
    <div className="bg-muted/35 border-b border-border px-3 py-1.5 shrink-0" data-testid="orphan-test-agents-surface">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        data-testid="orphan-test-toggle"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="font-medium">{orphanAgents.length} residual test agent{orphanAgents.length === 1 ? '' : 's'}</span>
        <span className="truncate">Residue from prior test runs; cleanup is manual via pan wipe.</span>
      </button>

      {expanded && (
        <div className="mt-1.5 grid gap-1 pl-5" data-testid="orphan-test-agent-list">
          {orphanAgents.map((agent) => {
            const issueId = agent.issueId ?? agent.id;
            return (
              <div key={agent.id} className="flex items-center gap-2 rounded border border-border/70 bg-background/60 px-2 py-1 text-xs">
                <span className="font-mono text-muted-foreground">{issueId}</span>
                <button
                  type="button"
                  onClick={() => copyWipeCommand(issueId)}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ClipboardCopy className="w-3 h-3" />
                  Copy `pan wipe {issueId}`
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
