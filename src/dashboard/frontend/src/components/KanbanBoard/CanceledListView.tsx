/**
 * Canceled cycle view — list grouped by cancellation type.
 * Extracted from KanbanBoard.tsx (file-size ratchet; PAN-2908 C-BOARD).
 */
import { X } from 'lucide-react';
import type { Issue, Agent } from '../../types';
import type { IssueCost } from './types';
import { ListIssueRow } from './cards';

type CanceledGroup = { name: string; issues: Issue[] };

export function CanceledListView({
  groups,
  issueWorkAgentsById,
  agents,
  specialists,
  issueCosts,
  costsLoading,
  selectedIssue,
  onSelectIssue,
  onPlan,
  isBulkSelected,
  onBulkToggle,
}: {
  groups: CanceledGroup[];
  issueWorkAgentsById: Map<string, Agent[]>;
  agents: Agent[];
  specialists: Agent[];
  issueCosts: Record<string, IssueCost>;
  costsLoading?: boolean;
  selectedIssue: string | null | undefined;
  onSelectIssue: (id: string | null) => void;
  onPlan: (issue: Issue, autoStart?: boolean) => void;
  isBulkSelected: (id: string) => boolean;
  onBulkToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-6 overflow-y-auto pb-4">
      {groups.map((group) => (
        <div key={group.name} className="bg-card rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <X className="w-4 h-4 text-destructive-foreground" />
              <h3 className="font-semibold text-foreground">{group.name}</h3>
              <span className="text-sm text-muted-foreground">({group.issues.length})</span>
            </div>
          </div>
          <div className="divide-y divide-divider">
            {group.issues.map((issue) => (
              <ListIssueRow
                key={issue.id}
                issue={issue}
                issueWorkAgentsById={issueWorkAgentsById}
                agents={agents}
                specialists={specialists}
                issueCosts={issueCosts}
                costsLoading={costsLoading}
                selectedIssue={selectedIssue}
                onSelectIssue={onSelectIssue}
                onPlan={onPlan}
                isBulkSelected={isBulkSelected(issue.identifier)}
                onBulkToggle={() => onBulkToggle(issue.identifier)}
              />
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No canceled issues
        </div>
      )}
    </div>
  );
}
