import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, MessageSquarePlus } from 'lucide-react';
import type { SessionNode } from '@overdeck/contracts';
import { FeatureItem, sessionMatchesFilter, type TreeSessionFilter } from './FeatureItem';
import type { Harness } from '../../shared/ModelPicker';
import styles from '../styles/command-deck.module.css';

export type ResourceSource = 'tracker' | 'tmux' | 'workspace' | 'branch' | 'pr' | 'prd' | 'vbrief' | 'tasks' | 'docker' | 'remote-agent' | 'conversation';

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
  hasXbrief: boolean;
  hasTasks: boolean;
  hasPrd: boolean;
  dockerContainerCount: number;
  /** PAN-1523: actual HEAD of the agent's workspace, or null when workspace is missing. */
  actualBranch?: string | null;
  /** PAN-1523: true when workspace HEAD differs from expected feature/<id> branch. */
  branchDrifted?: boolean;
  /** PAN-2602: true when a feature/* or bypass/* branch for the issue has unmerged commits not on main. */
  branchAheadOfMain?: boolean;
  /** PAN-1523: true when workspace path is configured but missing on disk. */
  workspaceMissing?: boolean;
  /** PAN-1676: remote (fly.io) work agent for this issue, when one is active. */
  remoteAgent?: { vmName: string; status: string; model: string; startedAt: string } | null;
  /** Non-archived conversations explicitly linked to this issue (PAN-2602). */
  conversations: Array<{ id: number; name: string; title: string | null; status: string }>;
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
  specOnlyPlanned?: boolean;
  sessions?: readonly SessionNode[];
  resourceSources?: ResourceSource[];
  resourceDetails?: ProjectFeatureResourceDetails;
  /** PAN-2602: per-issue task rollup totals from the cached bulk rollup. */
  taskTotals?: { total: number; closed: number; inProgress: number; lastUpdated: string | null } | null;
}

interface ProjectNodeProps {
  projectKey: string;
  name: string;
  features: ProjectFeature[];
  selectedFeature: string | null;
  onSelectFeature: (issueId: string) => void;
  onSelectProject?: (projectName: string) => void;
  selectedProject?: string | null;
  selectedSessionId?: string | null;
  onSelectSession?: (issueId: string, sessionId: string) => void;
  issueTitles?: Record<string, string>;
  issueCosts?: Record<string, number>;
  filter?: TreeSessionFilter;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
  onPauseSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onUnpauseSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
  onCleanupOrphanedResources?: (issueId: string) => void;
  onOpenPlanDialog?: (issueId: string) => void;
  onNewConversation?: (projectKey: string) => void;
  containerStats?: Record<string, { id: string; name: string; cpuPercent: number; memoryUsage: number; status: 'running' | 'stopped' | 'unhealthy' | 'restarting' }>;
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
  onRename,
  projectName,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
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
        border: '1px solid var(--border)',
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
          onRename();
          onClose();
        }}
      >
        Rename project
      </button>
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

export function ProjectNode({ projectKey, name, features, selectedFeature, onSelectFeature, onSelectProject, selectedProject, selectedSessionId, onSelectSession, issueTitles, issueCosts, filter = 'all', onStopSession, onViewTerminal, onPauseSession, onResumeSession, onUnpauseSession, onRestartSession, onDeepWipe, onOpenStateDir, onViewJsonl, onCleanupOrphanedResources, onOpenPlanDialog, onNewConversation, containerStats }: ProjectNodeProps) {
  const visibleFeatures = useMemo(() => {
    if (filter === 'all') return features;
    return features.filter((feature) =>
      (feature.sessions ?? []).some((session) => sessionMatchesFilter(session, filter)),
    );
  }, [features, filter]);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(visibleFeatures.length > 0);
  const [menu, setMenu] = useState<ContextMenuState>({ x: 0, y: 0, open: false });
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const draftNameRef = useRef('');
  const committingRef = useRef(false);

  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to rename project');
      }
    },
    onSuccess: async () => {
      setEditingName(false);
      setRenameError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['registered-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['session-trees'] }),
      ]);
    },
    onError: (error: Error) => {
      committingRef.current = false;
      setRenameError(error.message);
    },
  });

  const beginRename = useCallback(() => {
    committingRef.current = false;
    draftNameRef.current = name;
    setDraftName(name);
    setRenameError(null);
    setEditingName(true);
    setTimeout(() => editInputRef.current?.select(), 0);
  }, [name]);

  const commitRename = useCallback(() => {
    if (committingRef.current) return;
    committingRef.current = true;
    renameMutation.mutate(draftNameRef.current);
  }, [renameMutation]);

  const cancelRename = useCallback(() => {
    committingRef.current = true;
    setEditingName(false);
    setDraftName('');
    setRenameError(null);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, open: true });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu((m) => ({ ...m, open: false }));
  }, []);

  const handleSelectProject = useCallback(() => {
    onSelectProject?.(name);
    if (!expanded) setExpanded(true);
  }, [expanded, name, onSelectProject]);

  const handleToggleExpanded = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    setExpanded(current => !current);
  }, []);

  return (
    <div className={styles.projectNode}>
      <button
        className={styles.projectHeader}
        data-component="project-node"
        data-project-name={name}
        onClick={handleSelectProject}
        onContextMenu={handleContextMenu}
        title={renameError ?? undefined}
        style={{ background: selectedProject === name ? 'var(--accent)' : undefined }}
      >
        <span
          onClick={handleToggleExpanded}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
        >
          <ChevronRight
            className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
            size={14}
          />
        </span>
        {editingName ? (
          <span
            className={styles.projectName}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <input
              ref={editInputRef}
              aria-label={`Rename ${name}`}
              value={draftName}
              onChange={(event) => {
                draftNameRef.current = event.target.value;
                setDraftName(event.target.value);
                setRenameError(null);
              }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') cancelRename();
              }}
              onBlur={commitRename}
            />
            {renameError && <span role="alert">{renameError}</span>}
          </span>
        ) : (
          <span data-testid="command-deck-tree-title" className={`${styles.projectName} font-display`}>{name}</span>
        )}
        <span className={styles.featureCount}>{visibleFeatures.length}</span>
        {onNewConversation && (
          <span
            role="button"
            tabIndex={0}
            className={styles.projectAddConvBtn}
            onClick={e => { e.stopPropagation(); onNewConversation(name); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onNewConversation(name); } }}
            title="New conversation in this project"
            aria-label={`New conversation in ${name}`}
          >
            <MessageSquarePlus size={12} />
          </span>
        )}
      </button>

      {menu.open && (
        <ProjectNodeMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          onRename={beginRename}
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
              onUnpauseSession={onUnpauseSession}
              onRestartSession={onRestartSession}
              onDeepWipe={onDeepWipe}
              onOpenStateDir={onOpenStateDir}
              onViewJsonl={onViewJsonl}
              onCleanupOrphanedResources={onCleanupOrphanedResources}
              onOpenPlanDialog={onOpenPlanDialog}
              containerStats={containerStats}
            />
          ))
        ) : (
          <div className={styles.emptyProject}>(no active features)</div>
        )
      )}
    </div>
  );
}
