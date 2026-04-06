import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { ProjectNode, ProjectFeature } from './ProjectTree/ProjectNode';
import { ActivityView } from './ActivityView';
import { BadgeBar } from './FeatureMetadata/BadgeBar';
import { DeaconStatus } from './DeaconStatus';
import { BeadsDialog } from '../BeadsDialog';
import { ConversationList, type Conversation } from './ConversationList';
import { ConversationPanel } from '../chat/ConversationPanel';
import { DraftConversationPanel } from '../chat/DraftConversationPanel';
import type { Issue } from '../../types';
import styles from './styles/mission-control.module.css';

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

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

interface IssueCostEntry {
  issueId: string;
  totalCost: number;
}

async function fetchCostsByIssue(): Promise<{ issues: IssueCostEntry[] }> {
  const res = await fetch('/api/costs/by-issue');
  if (!res.ok) throw new Error('Failed to fetch costs');
  return res.json();
}

async function fetchVersion(): Promise<{ version: string }> {
  const res = await fetch('/api/version');
  if (!res.ok) throw new Error('Failed to fetch version');
  return res.json();
}

interface MissionControlProps {
  issues?: Issue[];
}

export function MissionControl({ issues = [] }: MissionControlProps) {
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [showBeads, setShowBeads] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('mc-sidebar-width');
    return saved ? Number(saved) : 600;
  });
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const currentWidth = useRef(sidebarWidth);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['mission-control-projects'],
    queryFn: fetchProjects,
    refetchInterval: 10000,
  });

  // Get aggregated cost data for all issues
  const { data: costData } = useQuery({
    queryKey: ['costs-by-issue'],
    queryFn: fetchCostsByIssue,
    refetchInterval: 15000,
  });

  const { data: versionData } = useQuery({
    queryKey: ['version'],
    queryFn: fetchVersion,
    staleTime: Infinity,
  });

  // Build title map from issues
  const issueTitles: Record<string, string> = {};
  const issueCosts: Record<string, number> = {};

  for (const issue of issues) {
    issueTitles[issue.identifier.toLowerCase()] = issue.title;
    issueTitles[issue.identifier] = issue.title;
  }

  // Map aggregated costs per issue (supports both upper and lower case keys)
  for (const entry of costData?.issues || []) {
    issueCosts[entry.issueId] = entry.totalCost;
    issueCosts[entry.issueId.toLowerCase()] = entry.totalCost;
  }

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  const handleSelectFeature = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
    setSelectedConversation(null);
    setIsDraft(false);
  }, []);

  const handleSelectConversation = useCallback((name: string | null) => {
    setSelectedConversation(name);
    setIsDraft(false);
    if (name !== null) {
      setSelectedFeature(null);
    }
  }, []);

  const handleDraftCreated = useCallback(() => {
    setIsDraft(true);
    setSelectedConversation(null);
    setSelectedFeature(null);
  }, []);

  const queryClient = useQueryClient();

  const handleDraftPromoted = useCallback((conv: Conversation) => {
    setIsDraft(false);
    setSelectedConversation(conv.name);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  }, [queryClient]);

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
      currentWidth.current = newWidth;
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        localStorage.setItem('mc-sidebar-width', String(currentWidth.current));
      }
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

          {/* Conversations section — above project tree */}
          <ConversationList
            selectedConversation={selectedConversation}
            onSelectConversation={handleSelectConversation}
            onDraftCreated={handleDraftCreated}
          />

          <div className={styles.projectTree}>
            {isLoading && projects.length === 0 ? (
              <div className={styles.skeletonList}>
                <div className={styles.skeletonItem} style={{ width: '60%' }} />
                <div className={styles.skeletonItem} style={{ width: '80%' }} />
                <div className={styles.skeletonItem} style={{ width: '45%' }} />
                <div className={styles.skeletonItem} style={{ width: '70%' }} />
              </div>
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

          <DeaconStatus />
          {versionData && (
            <div className={styles.sidebarFooter}>
              <span className={styles.versionLabel}>v{versionData.version}</span>
            </div>
          )}
        </div>

        {/* Resize Handle */}
        <div
          className={styles.resizeHandle}
          onMouseDown={handleMouseDown}
        />

        {/* Content Area */}
        <div className={styles.content}>
          {isDraft ? (
            <DraftConversationPanel
              onPromoted={handleDraftPromoted}
            />
          ) : selectedConversation ? (
            (() => {
              const conv = conversations.find(c => c.name === selectedConversation);
              return conv ? (
                <ConversationPanel key={conv.name} conversation={conv} onArchived={() => { setSelectedConversation(null); queryClient.invalidateQueries({ queryKey: ['conversations'] }); }} />
              ) : (
                <div className={styles.contentEmpty}>
                  <div style={{ textAlign: 'center' }}>
                    <p>Loading session…</p>
                  </div>
                </div>
              );
            })()
          ) : selectedFeature ? (
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
                source={issues.find(i => i.identifier === selectedFeature)?.source}
                onOpenBeads={() => setShowBeads(true)}
              />

              {/* Activity View */}
              <ActivityView
                issueId={selectedFeature}
                issues={issues}
                featureData={selectedFeatureData}
              />
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
