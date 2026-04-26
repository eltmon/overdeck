import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import { Compass, Plus } from 'lucide-react';
import { ProjectNode, ProjectFeature } from './ProjectTree/ProjectNode';
import type { TreeSessionFilter } from './ProjectTree/FeatureItem';
import { BadgeBar } from './FeatureMetadata/BadgeBar';
import { DeaconStatus } from './DeaconStatus';
import { DetailPanelLayout } from '../DetailPanelLayout';
import { IssueWorkbench } from './IssueWorkbench';
import { BeadsDialog } from '../BeadsDialog';
import { ConversationList, type Conversation } from './ConversationList';
import { ConversationPanel, type ViewMode } from '../chat/ConversationPanel';
import { ModelPicker, loadStoredModel, saveStoredModel } from '../chat/ModelPicker';
import { DraftConversationPanel } from '../chat/DraftConversationPanel';
import type { ChatMessage } from '../chat/chat-types';
import type { Agent, Issue } from '../../types';
import { useDashboardStore, selectAgentList } from '../../lib/store';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { WS_METHODS } from '@panopticon/contracts';
import type { ProjectSessionTree, SessionTreeDelta, SessionNode } from '@panopticon/contracts';
import styles from './styles/command-deck.module.css';

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
  const res = await fetch('/api/command-deck/projects');
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

/** Prefer active > idle > ended when auto-selecting a session on feature click. */
function pickBestSession(sessions: readonly SessionNode[]): SessionNode | null {
  if (sessions.length === 0) return null;
  const order: Record<string, number> = { active: 0, idle: 1, ended: 2 };
  return [...sessions].sort((a, b) => {
    const ao = order[a.presence] ?? 999;
    const bo = order[b.presence] ?? 999;
    return ao - bo;
  })[0] ?? null;
}

async function fetchProjectSessionTree(projectKey: string): Promise<ProjectSessionTree> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/session-tree`);
  if (!res.ok) throw new Error(`Failed to fetch session tree for ${projectKey}`);
  return res.json();
}

/** Apply a live delta to a cached ProjectSessionTree. Returns a new object or undefined if not applicable.
 *  Optimized to O(F + S) per delta by finding the target feature/session by index instead of nested scans.
 */
function applySessionTreeDelta(tree: ProjectSessionTree, delta: SessionTreeDelta): ProjectSessionTree {
  const deltaIssueIdLower = delta.issueId.toLowerCase();
  const featureIdx = tree.features.findIndex(f => f.issueId.toLowerCase() === deltaIssueIdLower);
  if (featureIdx === -1) return tree;

  const feature = tree.features[featureIdx];
  if (!feature) return tree;

  switch (delta.kind) {
    case 'session_added': {
      // Lightweight delta — invalidate to trigger refetch
      return tree;
    }
    case 'session_removed': {
      const filtered = feature.sessions.filter(s => s.sessionId !== delta.sessionId);
      if (filtered.length === feature.sessions.length) return tree;
      const newFeatures = [...tree.features];
      newFeatures[featureIdx] = { ...feature, sessions: filtered };
      return { ...tree, features: newFeatures };
    }
    case 'presence_changed':
    case 'status_changed': {
      const sessionIdx = feature.sessions.findIndex(s => s.sessionId === delta.sessionId);
      if (sessionIdx === -1) return tree;
      const newSessions = [...feature.sessions];
      newSessions[sessionIdx] = {
        ...feature.sessions[sessionIdx]!,
        ...(delta.presence !== undefined && { presence: delta.presence }),
        ...(delta.status !== undefined && { status: delta.status }),
      };
      const newFeatures = [...tree.features];
      newFeatures[featureIdx] = { ...feature, sessions: newSessions };
      return { ...tree, features: newFeatures };
    }
    default:
      return tree;
  }
}

interface CommandDeckProps {
  issues?: Issue[];
  /** Deep-link conversation ID — selects this conversation on mount */
  convId?: string | null;
  conversationViewMode?: ViewMode;
  /** Called when the selected conversation changes so App can sync the URL */
  onConvIdChange?: (id: string | null) => void;
  onConversationViewModeChange?: (mode: ViewMode) => void;
}

type SidebarTab = 'conversations' | 'projects';

export function CommandDeck({
  issues = [],
  convId,
  conversationViewMode = 'conversation',
  onConvIdChange,
  onConversationViewModeChange,
}: CommandDeckProps) {
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [showBeads, setShowBeads] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('conversations');
  const [treeFilter, setTreeFilter] = useState<TreeSessionFilter>('all');
  const [sidebarModel, setSidebarModel] = useState<string>(loadStoredModel);

  // Per-issue session selection (PAN-830 pan-11sr) — slice keyed by issueId.
  // The tree highlight uses the value for whichever feature is currently active.
  const selectSession = useCommandDeckSelection((s) => s.selectSession);
  const selectedSessionId = useCommandDeckSelection((s) =>
    selectedFeature ? s.selectedSessionByIssue[selectedFeature] ?? null : null,
  );
  // Increments each time + is clicked, forcing DraftConversationPanel to remount and re-read localStorage
  const [draftKey, setDraftKey] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('mc-sidebar-width');
    return saved ? Math.max(280, Number(saved)) : 320;
  });
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const currentWidth = useRef(sidebarWidth);
  const queryClient = useQueryClient();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['command-deck-projects'],
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

  // ── Session Tree (PAN-821) ───────────────────────────────────────────────────
  // Fetch session trees for all projects when in projects tab
  const sessionTreeQueries = useQueries({
    queries: projects.map(project => ({
      queryKey: ['session-tree', project.name],
      queryFn: () => fetchProjectSessionTree(project.name),
      enabled: sidebarTab === 'projects',
    })),
  });

  const sessionTreeDataRef = useRef<Record<string, ProjectSessionTree>>({});
  const sessionTreeMap = useMemo(() => {
    const map: Record<string, ProjectSessionTree> = {};
    let changed = false;
    for (const query of sessionTreeQueries) {
      if (query.data) {
        map[query.data.projectKey] = query.data;
        if (sessionTreeDataRef.current[query.data.projectKey] !== query.data) changed = true;
      }
    }
    if (!changed && Object.keys(map).length === Object.keys(sessionTreeDataRef.current).length) {
      return sessionTreeDataRef.current;
    }
    sessionTreeDataRef.current = map;
    return map;
  }, [sessionTreeQueries]);

  // Subscribe to live session tree deltas for each project
  useEffect(() => {
    if (sidebarTab !== 'projects') return;
    const transport = getTransport();
    const unsubscribes: Array<() => void> = [];

    for (const project of projects) {
      const unsubscribe = transport.subscribe(
        (client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.subscribeProjectSessionTree]({
            projectKey: project.name,
          }) as unknown as import('effect').Stream.Stream<SessionTreeDelta, Error>,
        (delta) => {
          const tree = queryClient.getQueryData<ProjectSessionTree>(['session-tree', project.name]);
          if (!tree) return;
          if (delta.kind === 'session_added') {
            // Lightweight delta — refetch to get full session data
            queryClient.invalidateQueries({ queryKey: ['session-tree', project.name] });
          } else {
            const updated = applySessionTreeDelta(tree, delta);
            queryClient.setQueryData(['session-tree', project.name], updated);
          }
        },
      );
      unsubscribes.push(unsubscribe);
    }

    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [sidebarTab, projects, queryClient]);

  // Merge session trees into project features
  const projectsWithSessions = useMemo(() => {
    return projects.map(project => {
      const tree = sessionTreeMap[project.name];
      if (!tree) return project;

      const featureSessions = new Map<string, import('@panopticon/contracts').SessionNode[]>();
      for (const feature of tree.features) {
        featureSessions.set(feature.issueId.toLowerCase(), [...feature.sessions]);
      }

      return {
        ...project,
        features: project.features.map((feature: ProjectFeature) => ({
          ...feature,
          sessions: featureSessions.get(feature.issueId.toLowerCase()) ?? feature.sessions,
        })),
      };
    });
  }, [projects, sessionTreeMap]);

  // Agents from dashboard store (for terminal panel in detail view)
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];

  // Build title map from issues (memoized to avoid new object identity per render)
  const issueTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const issue of issues) {
      map[issue.identifier.toLowerCase()] = issue.title;
      map[issue.identifier] = issue.title;
    }
    return map;
  }, [issues]);

  // Map aggregated costs per issue (memoized to avoid new object identity per render)
  const issueCosts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of costData?.issues || []) {
      map[entry.issueId] = entry.totalCost;
      map[entry.issueId.toLowerCase()] = entry.totalCost;
    }
    return map;
  }, [costData]);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  // Track the last deep-link ID we applied so we only navigate for *new* deep-links
  // (e.g. popstate), not on every conversations refetch.
  const appliedConvId = useRef<string | null>(null);

  // On mount or when convId changes (popstate), apply the deep-link
  useEffect(() => {
    if (!convId || conversations.length === 0) return;
    if (convId === appliedConvId.current) return;
    const conv = conversations.find((c) => String(c.id) === convId);
    if (conv) {
      setSelectedConversation(conv.name);
      appliedConvId.current = convId;
    }
  }, [convId, conversations]);

  // Auto-select first conversation on initial load if no deep-link and no feature selected
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (hasAutoSelected.current) return;
    if (conversations.length === 0 || convId || selectedConversation !== null || selectedFeature !== null) return;
    setSelectedConversation(conversations[0].name);
    hasAutoSelected.current = true;
  }, [conversations, convId, selectedConversation, selectedFeature]);

  // Sync URL when selected conversation changes (user clicks, draft promoted, etc.)
  // Use a ref to track the previous value so we only call onConvIdChange when it actually changes.
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onConvIdChange) return;
    if (selectedConversation === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedConversation;
    if (!selectedConversation) {
      onConvIdChange(null);
      return;
    }
    const conv = conversations.find((c) => c.name === selectedConversation);
    if (conv) {
      const nextId = String(conv.id);
      if (nextId === convId) return;
      onConvIdChange(nextId);
    }
  }, [selectedConversation, conversations, onConvIdChange, convId]);

  const handleSelectFeature = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
    // Auto-select the best alive session so the user doesn't have to click twice
    // (feature → session). Falls back to issue-selected mode when no sessions exist.
    let sessions: SessionNode[] = [];
    for (const project of projectsWithSessions) {
      const feature = project.features.find(f => f.issueId === issueId);
      if (feature) {
        sessions = feature.sessions ?? [];
        break;
      }
    }
    const best = pickBestSession(sessions);
    selectSession(issueId, best?.sessionId ?? null);
    setSelectedConversation(null);
    setIsDraft(false);
  }, [selectSession, projectsWithSessions]);

  const handleSelectSession = useCallback((issueId: string, sessionId: string) => {
    setSelectedFeature(issueId);
    selectSession(issueId, sessionId);
    setSelectedConversation(null);
    setIsDraft(false);
  }, [selectSession]);

  const handleStopSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to stop session');
      await refreshDashboardState(queryClient);
    } catch {
      // Silently ignore — the user can retry from Zone B if needed
    }
  }, [queryClient]);

  const handleViewTerminal = useCallback((sessionId: string) => {
    // Find which issue owns this session and select it
    for (const project of projectsWithSessions) {
      for (const feature of project.features) {
        if (feature.sessions?.some(s => s.sessionId === sessionId)) {
          setSelectedFeature(feature.issueId);
          selectSession(feature.issueId, sessionId);
          setSelectedConversation(null);
          setIsDraft(false);
          return;
        }
      }
    }
  }, [projectsWithSessions, selectSession]);

  const handleSelectConversation = useCallback((name: string | null) => {
    setDraftKey(0);
    setSelectedConversation(name);
    if (selectedFeature) {
      selectSession(selectedFeature, null);
    }
    setIsDraft(false);
    if (name !== null) {
      setSelectedFeature(null);
    }
  }, [selectSession, selectedFeature]);

  const handleDraftCreated = useCallback(() => {
    setDraftKey(k => k + 1);
    setIsDraft(true);
    setSelectedConversation(null);
    setSelectedFeature(null);
    setSidebarTab('conversations');
  }, []);

  const handleDraftPromoted = useCallback((conv: Conversation, firstMessage: string) => {
    setDraftKey(0);
    setIsDraft(false);
    setSelectedConversation(conv.name);
    // Update URL immediately — the conv isn't in the query cache yet so the
    // URL-sync effect can't resolve it; do it eagerly here.
    if (onConvIdChange) {
      const newId = String(conv.id);
      onConvIdChange(newId);
      appliedConvId.current = newId;
      prevSelectedRef.current = conv.name;
    }
    // Seed optimistic first message so it appears immediately before polling returns data
    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'user',
      text: firstMessage,
      createdAt: new Date().toISOString(),
    };
    queryClient.setQueryData(['conversation-messages', conv.name], {
      messages: [optimistic],
      workLog: [],
      streaming: true,
    });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  }, [queryClient, onConvIdChange]);

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
      const newWidth = Math.max(280, Math.min(500, startWidth.current + delta));
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

  // Find selected feature data (memoized to avoid O(P×F) scan per render)
  const selectedFeatureData = useMemo(() => {
    if (!selectedFeature) return null;
    for (const p of projectsWithSessions) {
      const f = p.features.find(f => f.issueId === selectedFeature);
      if (f) return f;
    }
    return null;
  }, [projectsWithSessions, selectedFeature]);

  const selectedIssueTitle = selectedFeature
    ? issueTitles[selectedFeature.toLowerCase()] || issueTitles[selectedFeature] || selectedFeature
    : '';

  const selectedIssue = selectedFeature
    ? issues.find(i => i.identifier === selectedFeature)
    : null;

  return (
    <div className={styles.commandDeck}>
      <div className={styles.layout}>
        {/* Sidebar: Project Tree */}
        <div className={styles.sidebar} style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
          <div className={styles.sidebarHeader}>
            <div className={styles.sidebarHeaderRow}>
              <h2 className={styles.sidebarTitle}>Command Deck</h2>
              {sidebarTab === 'conversations' && (
                <div className={styles.sidebarHeaderGroup}>
                  <ModelPicker
                    value={sidebarModel}
                    onChange={(modelId) => {
                      setSidebarModel(modelId);
                      saveStoredModel(modelId);
                    }}
                  />
                  <button
                    className={styles.conversationAddBtn}
                    onClick={handleDraftCreated}
                    title="New conversation"
                    aria-label="New conversation"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              )}
            </div>

            {/* Segmented control */}
            <div className={styles.segmentControl}>
              <button
                className={`${styles.segmentButton} ${sidebarTab === 'conversations' ? styles.segmentButtonActive : ''}`}
                onClick={() => setSidebarTab('conversations')}
              >
                Conversations
                <span className={styles.segmentCount}>{conversations.length}</span>
              </button>
              <button
                className={`${styles.segmentButton} ${sidebarTab === 'projects' ? styles.segmentButtonActive : ''}`}
                onClick={() => setSidebarTab('projects')}
              >
                Projects
                <span className={styles.segmentCount}>
                  {projects.reduce((sum, p) => sum + p.features.length, 0)}
                </span>
              </button>
            </div>

            {/* Tree session filter (blocker-4) */}
            {sidebarTab === 'projects' && (
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {(['all', 'alive', 'failed'] as TreeSessionFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setTreeFilter(f)}
                    style={{
                      flex: 1,
                      padding: '2px 6px',
                      fontSize: 10,
                      fontWeight: treeFilter === f ? 600 : 400,
                      border: '1px solid var(--mc-border)',
                      borderRadius: 4,
                      background: treeFilter === f ? 'var(--mc-bg-selected)' : 'transparent',
                      color: treeFilter === f ? 'var(--mc-text-primary)' : 'var(--mc-text-muted)',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tab content — each gets full height */}
          <div className={styles.projectTree}>
            {sidebarTab === 'conversations' ? (
              <ConversationList
                selectedConversation={selectedConversation}
                onSelectConversation={handleSelectConversation}
              />
            ) : isLoading && projects.length === 0 ? (
              <div className={styles.skeletonList}>
                <div className={styles.skeletonItem} style={{ width: '60%' }} />
                <div className={styles.skeletonItem} style={{ width: '80%' }} />
                <div className={styles.skeletonItem} style={{ width: '45%' }} />
                <div className={styles.skeletonItem} style={{ width: '70%' }} />
              </div>
            ) : projects.length === 0 ? (
              <div className={styles.emptyProject}>No projects configured</div>
            ) : (
              projectsWithSessions.map(project => (
                <ProjectNode
                  key={project.path}
                  name={project.name}
                  features={project.features}
                  selectedFeature={selectedFeature}
                  onSelectFeature={handleSelectFeature}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={handleSelectSession}
                  issueTitles={issueTitles}
                  issueCosts={issueCosts}
                  filter={treeFilter}
                  onStopSession={handleStopSession}
                  onViewTerminal={handleViewTerminal}
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
              key={draftKey}
              onPromoted={handleDraftPromoted}
            />
          ) : selectedConversation ? (
            (() => {
              const conv = conversations.find(c => c.name === selectedConversation);
              return conv ? (
                <ConversationPanel
                  key={conv.name}
                  conversation={conv}
                  viewMode={conversationViewMode}
                  onViewModeChange={onConversationViewModeChange}
                  onArchived={() => {
                    setSelectedConversation(null);
                    queryClient.invalidateQueries({ queryKey: ['conversations'] });
                  }}
                />
              ) : (
                <div className={styles.contentEmpty}>
                  <div style={{ textAlign: 'center' }}>
                    <p>Loading session…</p>
                  </div>
                </div>
              );
            })()
          ) : selectedFeature && sidebarTab === 'projects' ? (
            (() => {
              const selectedAgent = agents.find(a => a.issueId?.toLowerCase() === selectedFeature?.toLowerCase() && a.id.startsWith('agent-'))
                ?? agents.find(a => a.issueId?.toLowerCase() === selectedFeature?.toLowerCase());
              return (
                <IssueWorkbench
                  issueId={selectedFeature}
                  title={selectedIssueTitle}
                  sessions={selectedFeatureData?.sessions ?? []}
                  cost={issueCosts[selectedFeature.toLowerCase()] ?? issueCosts[selectedFeature]}
                  source={selectedIssue?.source}
                  url={selectedIssue?.url}
                  onOpenBeads={() => setShowBeads(true)}
                  issues={issues}
                  featureData={selectedFeatureData}
                  agent={selectedAgent}
                  issue={selectedIssue ?? undefined}
                />
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

              {/* Inspector + Terminal split view */}
              {(() => {
                const issue = issues.find(i => i.identifier === selectedFeature);
                const agent = agents.find(a => a.issueId?.toLowerCase() === selectedFeature?.toLowerCase() && a.id.startsWith('agent-'))
                  ?? agents.find(a => a.issueId?.toLowerCase() === selectedFeature?.toLowerCase());
                return issue ? (
                  <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <DetailPanelLayout
                      inline
                      agent={agent}
                      issueId={selectedFeature}
                      issue={issue}
                      issueUrl={issue.url}
                      onClose={() => setSelectedFeature(null)}
                    />
                  </div>
                ) : null;
              })()}
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
