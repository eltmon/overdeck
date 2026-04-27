import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { SessionNode } from '@panctl/contracts';
import { FeatureItem, sessionMatchesFilter, type TreeSessionFilter } from './FeatureItem';
import styles from '../styles/command-deck.module.css';

export type ResourceSource = 'tracker' | 'tmux' | 'workspace' | 'branch' | 'pr' | 'vbrief' | 'beads' | 'docker';

export interface ProjectFeatureResourceDetails {
  hasWorkspace: boolean;
  localBranchCount: number;
  remoteBranchCount: number;
  tmuxSessionCount: number;
  prs: Array<{
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
  }>;
  hasVbrief: boolean;
  hasBeads: boolean;
  dockerContainerCount: number;
}

export interface ProjectFeatureResourceIdentifiers {
  workspacePaths: string[];
  localBranchNames: string[];
  remoteBranchNames: string[];
  tmuxSessionNames: string[];
  prs: Array<{
    number: number;
    title: string;
    state: string;
    isDraft: boolean;
  }>;
  dockerContainerNames: string[];
}

export interface ProjectFeature {
  issueId: string;
  title: string;
  projectName: string;
  branch: string;
  status: string;
  stateLabel: string;
  agentStatus: string | null;
  hasPlanning: boolean;
  hasPrd: boolean;
  hasState: boolean;
  isShadow: boolean;
  cost?: number;
  isRally?: boolean;
  childCount?: number;
  completedCount?: number;
  inProgressCount?: number;
  rawTrackerState?: string;
  readyForMerge?: boolean;
  sessions?: readonly SessionNode[];
  resourceSources?: ResourceSource[];
  resourceDetails?: ProjectFeatureResourceDetails;
}

interface ProjectNodeProps {
  name: string;
  features: ProjectFeature[];
  selectedFeature: string | null;
  onSelectFeature: (issueId: string) => void;
  selectedSessionId?: string | null;
  onSelectSession?: (issueId: string, sessionId: string) => void;
  issueTitles?: Record<string, string>;
  issueCosts?: Record<string, number>;
  filter?: TreeSessionFilter;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
  onPauseSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  onCleanupOrphanedResources?: (issueId: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  open: boolean;
}

function ProjectNodeMenu({
  x,
  y,
  onClose,
  projectName,
}: {
  x: number;
  y: number;
  onClose: () => void;
  projectName: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
        background: 'var(--card)',
        border: '1px solid var(--mc-border, var(--border))',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '4px 0',
        minWidth: 160,
        fontSize: 12,
      }}
    >
      <button
        style={{
          display: 'block',
          width: '100%',
          padding: '6px 12px',
          border: 'none',
          background: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'var(--foreground)',
          fontSize: 12,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
        onClick={() => {
          navigator.clipboard?.writeText(projectName).catch(() => { /* ignore */ });
          onClose();
        }}
      >
        Copy project name
      </button>
    </div>
  );
}

export function ProjectNode({ name, features, selectedFeature, onSelectFeature, selectedSessionId, onSelectSession, issueTitles, issueCosts, filter, onStopSession, onViewTerminal, onPauseSession, onResumeSession, onRestartSession, onDeepWipe, onOpenStateDir, onViewJsonl, onCleanupOrphanedResources }: ProjectNodeProps) {
  const visibleFeatures = useMemo(() => {
    if (filter === 'all') return features;
    return features.filter((feature) =>
      (feature.sessions ?? []).some((session) => sessionMatchesFilter(session, filter)),
    );
  }, [features, filter]);
  const [expanded, setExpanded] = useState(features.length > 0);
  const [menu, setMenu] = useState<ContextMenuState>({ x: 0, y: 0, open: false });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, open: true });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu((m) => ({ ...m, open: false }));
  }, []);

  return (
    <div className={styles.projectNode}>
      <button
        className={styles.projectHeader}
        onClick={() => setExpanded(!expanded)}
        onContextMenu={handleContextMenu}
      >
        <ChevronRight
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
          size={14}
        />
        <span className={styles.projectName}>{name}</span>
        <span className={styles.featureCount}>{visibleFeatures.length}</span>
      </button>

      {menu.open && (
        <ProjectNodeMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          projectName={name}
        />
      )}

      {expanded && (
        visibleFeatures.length > 0 ? (
          visibleFeatures.map(feature => (
            <FeatureItem
              key={feature.issueId}
              feature={feature}
              isSelected={selectedFeature === feature.issueId}
              onSelect={() => onSelectFeature(feature.issueId)}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
              title={issueTitles?.[feature.issueId.toLowerCase()] || issueTitles?.[feature.issueId] || feature.title}
              cost={issueCosts?.[feature.issueId.toLowerCase()] || issueCosts?.[feature.issueId]}
              filter={filter}
              onStopSession={onStopSession}
              onViewTerminal={onViewTerminal}
              onPauseSession={onPauseSession}
              onResumeSession={onResumeSession}
              onRestartSession={onRestartSession}
              onDeepWipe={onDeepWipe}
              onOpenStateDir={onOpenStateDir}
              onViewJsonl={onViewJsonl}
              onCleanupOrphanedResources={onCleanupOrphanedResources}
            />
          ))
        ) : (
          <div className={styles.emptyProject}>(no active features)</div>
        )
      )}
    </div>
  );
}
