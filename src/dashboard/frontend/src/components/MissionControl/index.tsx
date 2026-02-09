import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { ProjectNode, ProjectFeature } from './ProjectTree/ProjectNode';
import { ActivityView } from './ActivityView';
import { BadgeBar } from './FeatureMetadata/BadgeBar';
import { BeadsDialog } from '../BeadsDialog';
import type { Issue } from '../../types';
import { useCostStream } from '../../hooks/useCostStream';
import styles from './styles/mission-control.module.css';

interface ProjectData {
  name: string;
  path: string;
  features: ProjectFeature[];
}

async function fetchProjects(): Promise<ProjectData[]> {
  const res = await fetch('/api/mission-control/projects');
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

interface MissionControlProps {
  issues?: Issue[];
}

export function MissionControl({ issues = [] }: MissionControlProps) {
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [showBeads, setShowBeads] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['mission-control-projects'],
    queryFn: fetchProjects,
    refetchInterval: 10000,
  });

  // Get cost data for features
  const { eventsByIssue } = useCostStream({ pollInterval: 10000 });

  // Build title map from issues
  const issueTitles: Record<string, string> = {};
  const issueCosts: Record<string, number> = {};

  for (const issue of issues) {
    issueTitles[issue.identifier.toLowerCase()] = issue.title;
    issueTitles[issue.identifier] = issue.title;
  }

  // Calculate costs per issue
  for (const [issueId, events] of Object.entries(eventsByIssue)) {
    issueCosts[issueId] = events.reduce((sum, e) => sum + e.cost, 0);
  }

  const handleSelectFeature = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
  }, []);

  // Resizable sidebar drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, [sidebarWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.max(240, Math.min(600, startWidth.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Find selected feature data
  const selectedFeatureData = selectedFeature
    ? projects.flatMap(p => p.features).find(f => f.issueId === selectedFeature)
    : null;

  const selectedIssueTitle = selectedFeature
    ? issueTitles[selectedFeature.toLowerCase()] || issueTitles[selectedFeature] || selectedFeature
    : '';

  return (
    <div className={styles.missionControl}>
      <div className={styles.layout}>
        {/* Sidebar: Project Tree */}
        <div className={styles.sidebar} style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
          <div className={styles.sidebarHeader}>
            <h2 className={styles.sidebarTitle}>Mission Control</h2>
            <p className={styles.sidebarSubtitle}>Active features across projects</p>
          </div>

          <div className={styles.projectTree}>
            {isLoading && projects.length === 0 ? (
              <div className={styles.emptyProject}>Loading projects...</div>
            ) : projects.length === 0 ? (
              <div className={styles.emptyProject}>No projects configured</div>
            ) : (
              projects.map(project => (
                <ProjectNode
                  key={project.path}
                  name={project.name}
                  features={project.features}
                  selectedFeature={selectedFeature}
                  onSelectFeature={handleSelectFeature}
                  issueTitles={issueTitles}
                  issueCosts={issueCosts}
                />
              ))
            )}
          </div>
        </div>

        {/* Resize Handle */}
        <div
          className={styles.resizeHandle}
          onMouseDown={handleMouseDown}
        />

        {/* Content Area */}
        <div className={styles.content}>
          {selectedFeature ? (
            <>
              {/* Feature Header */}
              <div className={styles.featureHeader}>
                <h1 className={styles.featureTitle}>{selectedIssueTitle}</h1>
                <span className={styles.featureId}>{selectedFeature}</span>
                {selectedFeatureData?.isShadow && (
                  <span className={styles.badge} style={{ borderColor: 'var(--mc-accent)', color: 'var(--mc-accent)' }}>
                    Shadow
                  </span>
                )}
              </div>

              {/* Badge Bar */}
              <BadgeBar
                issueId={selectedFeature}
                onOpenBeads={() => setShowBeads(true)}
              />

              {/* Activity View */}
              <ActivityView issueId={selectedFeature} />
            </>
          ) : (
            <div className={styles.contentEmpty}>
              <div style={{ textAlign: 'center' }}>
                <Compass size={48} style={{ marginBottom: 'var(--mc-space-4)', opacity: 0.3 }} />
                <p>Select a feature to view activity</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Beads Dialog */}
      {showBeads && selectedFeature && (
        <BeadsDialog
          issueId={selectedFeature}
          isOpen={showBeads}
          onClose={() => setShowBeads(false)}
        />
      )}
    </div>
  );
}
