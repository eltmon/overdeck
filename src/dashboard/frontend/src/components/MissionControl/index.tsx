import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Plus } from 'lucide-react';
import { ProjectNode, ProjectFeature } from './ProjectTree/ProjectNode';
import { BadgeBar } from './FeatureMetadata/BadgeBar';
import { DeaconStatus } from './DeaconStatus';
import { DetailPanelLayout } from '../DetailPanelLayout';
import { BeadsDialog } from '../BeadsDialog';
import { ConversationList, type Conversation } from './ConversationList';
import { ConversationPanel, type ViewMode } from '../chat/ConversationPanel';
import { ModelPicker, loadStoredModel, saveStoredModel } from '../chat/ModelPicker';
import { DraftConversationPanel } from '../chat/DraftConversationPanel';
import type { ChatMessage } from '../chat/chat-types';
import type { Agent, Issue } from '../../types';
import { useDashboardStore, selectAgentList } from '../../lib/store';
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

interface MissionControlProps {
  issues?: Issue[];
  /** Deep-link conversation ID — selects this conversation on mount */
  convId?: string | null;
  conversationViewMode?: ViewMode;
  /** Called when the selected conversation changes so App can sync the URL */
  onConvIdChange?: (id: string | null) => void;
  onConversationViewModeChange?: (mode: ViewMode) => void;
}

type SidebarTab = 'conversations' | 'projects';

export function MissionControl({
  issues = [],
  convId,
  conversationViewMode = 'conversation',
  onConvIdChange,
  onConversationViewModeChange,
}: MissionControlProps) {
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [showBeads, setShowBeads] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('conversations');
  const [sidebarModel, setSidebarModel] = useState<string>(loadStoredModel);
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

  // Agents from dashboard store (for terminal panel in detail view)
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];

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
    setSelectedConversation(null);
    setIsDraft(false);
  }, []);

  const handleSelectConversation = useCallback((name: string | null) => {
    setDraftKey(0);
    setSelectedConversation(name);
    setIsDraft(false);
    if (name !== null) {
      setSelectedFeature(null);
    }
  }, []);

  const handleDraftCreated = useCallback(() => {
    setDraftKey(k => k + 1);
    setIsDraft(true);
    setSelectedConversation(null);
    setSelectedFeature(null);
    setSidebarTab('conversations');
  }, []);

  const queryClient = useQueryClient();

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
