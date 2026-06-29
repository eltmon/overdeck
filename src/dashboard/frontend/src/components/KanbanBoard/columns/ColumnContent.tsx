import { Issue, Agent } from '../../../types';
import type { WorkspaceData } from '../../CommandDeck/ZoneCOverviewTabs/queries';
import { buildHierarchy } from '../kanban-utils';
import type { IssueCost, PlanningState } from '../types';
import { CompactChildCard, DraggableCardWrapper, FeatureCard, IssueCard } from '../cards';

// ColumnContent — renders issues with Rally hierarchy grouping
export function ColumnContent({
  issues,
  issueWorkAgentsById,
  agents,
  specialists,
  issueCosts,
  costsLoading,
  selectedIssue,
  onSelectIssue,
  onOpenIssue,
  onPlan,
  onViewBeads,
  onViewVBrief,
  collapsedFeatures,
  onToggleFeature,
  bulkSelectedIds,
  onBulkToggle,
  planningStateById,
  workspaceByIssueId,
}: {
  issues: Issue[];
  issueWorkAgentsById: Map<string, Agent[]>;
  agents: Agent[];
  /** PAN-1048 — role-tagged agents (review / test / ship). */
  specialists: Agent[];
  issueCosts: Record<string, IssueCost>;
  costsLoading?: boolean;
  selectedIssue: string | null | undefined;
  onSelectIssue: (id: string | null) => void;
  onOpenIssue: (id: string) => void;
  onPlan: (issue: Issue, autoStart?: boolean) => void;
  onViewBeads: (issue: Issue) => void;
  onViewVBrief?: (issue: Issue) => void;
  collapsedFeatures: Set<string>;
  onToggleFeature: (featureId: string) => void;
  bulkSelectedIds?: Set<string>;
  onBulkToggle?: (issueId: string) => void;
  planningStateById?: Record<string, PlanningState>;
  workspaceByIssueId?: Record<string, WorkspaceData>;
}) {
  // Check if any Rally issues with hierarchy exist
  const hasRallyHierarchy = issues.some(i => i.artifactType?.includes('PortfolioItem'));
  const hierarchy = hasRallyHierarchy ? buildHierarchy(issues) : null;

  const renderIssueCard = (issue: Issue) => {
    const issueIdLower = issue.identifier.toLowerCase();
    const workAgents = issueWorkAgentsById.get(issueIdLower) ?? [];
    const workAgent = workAgents[0];
    const planningAgent = agents.find(
      (a) => a.issueId?.toLowerCase() === issueIdLower && a.id?.startsWith('planning-')
    );
    const issueSpecialists = specialists.filter(
      (s) => s.issueId?.toLowerCase() === issueIdLower && s.status !== 'stopped'
    );

    return (
      <DraggableCardWrapper key={issue.id} issue={issue}>
        <IssueCard
          issue={issue}
        workAgent={workAgent}
        workAgents={workAgents}
        planningAgent={planningAgent}
        specialists={issueSpecialists}
        cost={issueCosts[issue.identifier.toLowerCase()]}
        costsLoading={costsLoading}
        isSelected={selectedIssue === issue.identifier}
        onSelect={() => onOpenIssue(issue.identifier)}
        onPlan={(autoStart) => onPlan(issue, autoStart)}
        onViewBeads={(i) => onViewBeads(i)}
        onViewVBrief={onViewVBrief ? (i) => onViewVBrief(i) : undefined}
        isBulkSelected={bulkSelectedIds?.has(issue.identifier)}
        onBulkToggle={onBulkToggle ? () => onBulkToggle(issue.identifier) : undefined}
        planningState={planningStateById?.[issue.identifier]}
          workspace={workspaceByIssueId?.[issue.identifier.toUpperCase()]}
        />
      </DraggableCardWrapper>
    );
  };

  if (issues.length === 0) {
    return (
      <div className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
        <div className="text-center text-muted-foreground py-8 text-sm">
          No issues
        </div>
      </div>
    );
  }

  // Flat rendering (no hierarchy)
  if (!hierarchy) {
    return (
      <div className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
        {issues.map(renderIssueCard)}
      </div>
    );
  }

  // Hierarchical rendering with Feature groups
  return (
    <div className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
      {hierarchy.map((group) => {
        if (group.type === 'orphan') {
          return renderIssueCard(group.children[0]);
        }

        // Feature group
        const feature = group.feature!;
        const isExpanded = !collapsedFeatures.has(feature.identifier);

        return (
          <FeatureCard
            key={`feature-${feature.id}`}
            feature={feature}
            childCount={group.children.length}
            isExpanded={isExpanded}
            onToggle={() => onToggleFeature(feature.identifier)}
            isSelected={selectedIssue === feature.identifier}
            onSelect={() => onSelectIssue(
              selectedIssue === feature.identifier ? null : feature.identifier
            )}
            onPlan={() => onPlan(feature)}
            onViewBeads={() => onViewBeads(feature)}
            onViewVBrief={onViewVBrief ? () => onViewVBrief(feature) : undefined}
            planningState={planningStateById?.[feature.identifier]}
          >
            {group.children.map(child => (
              <CompactChildCard
                key={child.id}
                issue={child}
                agents={agents}
                isSelected={selectedIssue === child.identifier}
                onSelect={() => onSelectIssue(
                  selectedIssue === child.identifier ? null : child.identifier
                )}
              />
            ))}
          </FeatureCard>
        );
      })}
    </div>
  );
}
