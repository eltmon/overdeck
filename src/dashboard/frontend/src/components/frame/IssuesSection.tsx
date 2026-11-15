/**
 * IssuesSection — the left column's issue tree for the selected project
 * (PAN-5293 F-D16, F-D17): ProjectNode in its frame variant (eyebrow
 * "Issues", count, CI / deploy / identity chips, the filter menu) inside the
 * project's membership boundary, wired to the extracted deck handlers. It is
 * the only owner of the container-stats poll (F-D4).
 */

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Issue } from '../../types';
import { useDashboardStore } from '../../lib/store';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { ProjectNode } from '../CommandDeck/ProjectTree/ProjectNode';
import type { TreeSessionFilter } from '../CommandDeck/ProjectTree/FeatureItem';
import { ProjectMembershipBoundary } from '../CommandDeck/ProjectMembershipBoundary';
import { issueTitlesByKey } from '../CommandDeck/agentIdsByIssueKey';
import { IssuesFilterMenu } from './IssuesFilterMenu';
import { useDeckProjects } from './deck/useDeckProjects';
import { useProjectScope } from './deck/useProjectScope';
import { useIssueSessionActions } from './deck/useIssueSessionActions';
import { useIssueCosts } from './deck/useIssueCosts';
import { useContainerStats } from './deck/useContainerStats';

export function IssuesSection({ selectedProject }: { selectedProject: string | null }) {
  const [filter, setFilter] = useState<TreeSessionFilter>('all');
  const { projectsWithSessions, isLoading } = useDeckProjects();
  const { selectedProjectData, visibleFeatures, selectedRegisteredProject, membership } = useProjectScope(selectedProject);
  const actions = useIssueSessionActions(selectedProject);
  const { issueCosts } = useIssueCosts();
  const containerStats = useContainerStats(projectsWithSessions);
  const selectedFeature = useCommandDeckSelection((s) => s.selectedFeature);
  const selectedSessionId = useCommandDeckSelection((s) => (s.selectedFeature ? s.selectedSessionByIssue[s.selectedFeature] ?? null : null));
  const issueTitles = useDashboardStore(useShallow((s) => issueTitlesByKey(s.issuesRaw as Issue[])));

  return (
    <section aria-label="Issues" data-testid="left-issues">
      <ProjectMembershipBoundary
        selectedProject={selectedProject}
        projectKey={selectedRegisteredProject?.key ?? selectedProjectData?.key}
        projectName={selectedProjectData?.name}
        loading={isLoading && !selectedProjectData}
        disabled={membership.pending || membership.registryError || membership.unknown}
      >
        {selectedProjectData ? (
          <ProjectNode
            key={selectedProjectData.path}
            variant="frame"
            headerActions={<IssuesFilterMenu filter={filter} onFilterChange={setFilter} />}
            projectKey={selectedProjectData.key}
            name={selectedProjectData.name}
            features={visibleFeatures}
            selectedFeature={selectedFeature}
            onSelectFeature={actions.handleSelectFeature}
            selectedProject={selectedProject}
            selectedSessionId={selectedSessionId}
            onSelectSession={actions.handleSelectSession}
            issueTitles={issueTitles}
            issueCosts={issueCosts}
            filter={filter}
            onStopSession={actions.handleStopSession}
            onViewTerminal={actions.handleViewTerminal}
            onPauseSession={actions.handlePauseSession}
            onResumeSession={actions.handleResumeSession}
            onUnpauseSession={actions.handleUnpauseSession}
            onRestartSession={actions.handleRestartSession}
            onDeepWipe={actions.handleDeepWipe}
            onOpenStateDir={actions.handleOpenStateDir}
            onViewJsonl={actions.handleViewJsonl}
            onCleanupOrphanedResources={actions.handleCleanupOrphanedResources}
            onOpenPlanDialog={actions.handleOpenPlanDialog}
            containerStats={containerStats}
          />
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No issues for this project</p>
        )}
      </ProjectMembershipBoundary>
    </section>
  );
}
