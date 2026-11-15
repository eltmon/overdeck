import { useCallback, useRef, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stage } from '../Stage';
import { ProjectHome } from '../Stage/ProjectHome';
import { IssueOverview } from '../Stage/IssueOverview';
import { NO_PROJECT_KEY, NO_PROJECT_LABEL } from './projectsData';
import { type Conversation } from './ConversationList';
import { openConversationTab } from './openConversationTab';
import { type ViewMode } from '../chat/ConversationPanel';
import type { Issue } from '../../types';
import { useDashboardStore } from '../../lib/store';
import { useAgentSetInvalidation } from '../../lib/useAgentSetInvalidation';
import { agentIdsByIssueKey, issueCreatedAtById, issueTitlesByKey } from './agentIdsByIssueKey';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import styles from './styles/command-deck.module.css';
import { fetchRegisteredProjects, ProjectRegistryErrorState, UnknownProjectState } from './UnknownProjectState';
import { DeckEmptyState } from './DeckEmptyState';
import { useDefaultDeckSelection } from './useDefaultDeckSelection';
import { usePriorityConversation } from './usePriorityConversation';
import { LoadingBoundary } from '../primitives/LoadingBoundary';
import { useDeckProjects } from '../frame/deck/useDeckProjects';
import { useIssueCosts } from '../frame/deck/useIssueCosts';
import { fetchConversations, useProjectScope } from '../frame/deck/useProjectScope';
import { openIssueTabIn, useIssueSessionActions } from '../frame/deck/useIssueSessionActions';
import { useCreateConversation } from '../frame/deck/useCreateConversation';
import { conversationRouteKey } from '../../lib/linkedConversation';

interface CommandDeckProps {
  /** Deep-link conversation ID — selects this conversation on mount */
  convId?: string | null;
  conversationViewMode?: ViewMode;
  pendingConversationTarget?: {
    conversationName: string;
    messageId: string;
    messageIndex?: number;
    nonce: number;
    label: string;
    subagentId?: string;
  } | null;
  onPendingConversationTargetConsumed?: () => void;
  /** Called when the selected conversation changes so App can sync the URL */
  onConvIdChange?: (id: string | null) => void;
  onConversationViewModeChange?: (mode: ViewMode) => void;
  /** PAN-1561: the project whose deck is shown, driven by the App sidebar. */
  selectedProject?: string | null;
  /** PAN-1561: switch the active project (e.g. when a conversation resolves to
   * a different project than the one currently shown). */
  onSelectProject?: (projectName: string | null, opts?: { updateUrl?: boolean }) => void;
  /** PAN-1593: report the selected project's issue prefix (e.g. "PAN") so the
   * app-bar search can scope to it. Null when no single prefix is resolvable. */
  onProjectPrefixChange?: (prefix: string | null) => void;
  /** PAN-2005: cockpit deep-link — open this issue's cockpit tab on mount/popstate. */
  cockpitIssue?: { project: string; issue: string } | null;
  /** PAN-2005: called when the selected issue changes so App can sync the URL
   * to /command-deck/<project>/<issue>. */
  onCockpitChange?: (projectKey: string | null, issueId: string | null) => void;
}

function ProjectPendingState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="status" className="flex items-center justify-center p-8">
      <LoadingBoundary label="The project" timeoutMs={8000} onRetry={onRetry}><span>Loading project…</span></LoadingBoundary>
    </div>
  )
}

// PAN-5293 F-D1: the left column and the deck share selection through this store.
const setSelectedFeature = (id: string | null) => useCommandDeckSelection.getState().setSelectedFeature(id);
const setSelectedConversation = (name: string | null) => useCommandDeckSelection.getState().setSelectedConversation(name);

export function CommandDeck({
  convId,
  pendingConversationTarget = null,
  onPendingConversationTargetConsumed,
  onConvIdChange,
  selectedProject = null,
  onSelectProject,
  onProjectPrefixChange,
  cockpitIssue = null,
  onCockpitChange,
  conversationViewMode,
}: CommandDeckProps) {
  const selectedFeature = useCommandDeckSelection((s) => s.selectedFeature);
  const selectedConversation = useCommandDeckSelection((s) => s.selectedConversation);
  const queryClient = useQueryClient();
  // PAN-2893: agent spawn/stop events refetch the projects pane immediately.
  useAgentSetInvalidation(queryClient);

  // PAN-5293 F-D4: the left column's DeckDataHost owns the session-tree subscription.
  const { projectsWithSessions } = useDeckProjects();
  const { issueCosts, issueCostDetails } = useIssueCosts();

  const { data: registeredProjects = [], isFetched: registeredProjectsFetched, isError: registeredProjectsError, refetch: refetchRegisteredProjects } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });
  useDefaultDeckSelection({ selectedProject, registeredProjects, onSelectProject, convId, loaded: registeredProjectsFetched && !registeredProjectsError });

  useEffect(() => {
    // A pending conversation deep-link (convId) must win over auto-select:
    // onSelectProject's default path clears the conversation route, which would
    // drop the deep-link before the effect below applies it.
    if (selectedProject || !onSelectProject || convId) return;
    const projectsWithFeatures = projectsWithSessions.filter((project) => project.features.length > 0);
    if (projectsWithFeatures.length === 1) {
      onSelectProject(projectsWithFeatures[0]!.name);
    }
  }, [convId, onSelectProject, projectsWithSessions, selectedProject]);

  // PAN-4560: flat lookup maps instead of the whole agent and issue slices, so
  // the deck re-renders only when an entry it reads changes. Handlers read the
  // store at call time.
  const agentIdByIssue = useDashboardStore(useShallow((s) => agentIdsByIssueKey(s.agentsById)));
  const issueTitles = useDashboardStore(useShallow((s) => issueTitlesByKey(s.issuesRaw as Issue[])));
  const createdAtByIssue = useDashboardStore(useShallow((s) => issueCreatedAtById(s.issuesRaw as Issue[])));


  const { data: conversationList = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  const { conversations, error: conversationRouteError } = usePriorityConversation(convId, conversationList);

  const { handleSelectFeature } = useIssueSessionActions(selectedProject);
  const {
    projectConvs, projectIssueIds, selectedProjectData, visibleFeatures,
    selectedRegisteredProject, resolveConversationProjectName, membership,
  } = useProjectScope(selectedProject, conversations);
  const isProjectValidationPending = membership.pending;
  const showUnknownProject = membership.unknown;

  // Track the last deep-link ID we applied so we only navigate for *new* deep-links
  // (e.g. popstate), not on every conversations refetch.
  const appliedConvId = useRef<string | null>(null);
  // PAN-2005: same idea for the issue cockpit deep-link (/command-deck/<proj>/<issue>).
  const appliedCockpit = useRef<string | null>(null);

  const openConversationTabIn = useCallback((projectKey: string, name: string, label: string, target?: {
    messageId: string;
    messageIndex?: number;
    nonce: number;
    subagentId?: string;
  }, viewMode?: ViewMode) => openConversationTab(projectKey, name, label, target, viewMode), []);

  // On mount or when convId changes (popstate), apply the deep-link: switch to
  // the conversation's project and open it as an agent tab in that deck.
  useEffect(() => {
    if (!convId || !registeredProjectsFetched || registeredProjectsError) return;
    // The view mode is part of the deep link: switching ?view=terminal on an
    // already-open conversation must re-apply, not be skipped as "unchanged".
    const deepLinkKey = `${convId}::${conversationViewMode ?? 'conversation'}`;
    if (deepLinkKey === appliedConvId.current) return;
    const conv = conversations.find((c) => String(c.id) === convId || c.name === convId);
    if (!conv) return;
    setSelectedConversation(conv.name);
    setSelectedFeature(null);
    const projectName = resolveConversationProjectName(conv) ?? NO_PROJECT_KEY;
    const target = pendingConversationTarget?.conversationName === conv.name
      ? {
          messageId: pendingConversationTarget.messageId,
          messageIndex: pendingConversationTarget.messageIndex,
          nonce: pendingConversationTarget.nonce,
          subagentId: pendingConversationTarget.subagentId,
        }
      : undefined;
    // Opening a conversation: the /conv/<id> route owns the URL, so switch the
    // deck's project without writing /command-deck/<project> over it.
    onSelectProject?.(projectName, { updateUrl: false });
    openConversationTabIn(
      projectName,
      conv.name,
      pendingConversationTarget?.label ?? conv.title ?? 'Agent',
      target,
      conversationViewMode === 'terminal' ? 'terminal' : undefined,
    );
    if (target) onPendingConversationTargetConsumed?.();
    appliedConvId.current = deepLinkKey;
  }, [convId, conversations, registeredProjectsFetched, registeredProjectsError, resolveConversationProjectName, onSelectProject, openConversationTabIn, pendingConversationTarget, onPendingConversationTargetConsumed, conversationViewMode]);

  // Auto-select first conversation on initial load if no deep-link and no feature selected.
  // An `?issue=` deep-link (issue cockpit/drawer, e.g. ?issue=PAN-1908&tab=conversation)
  // is ALSO a deep-link: without this guard, auto-select grabbed conversations[0] and
  // navigated to /conv/<id>, bouncing the operator off the issue's work-agent view onto an
  // unrelated conversation on every page load/reload.
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (hasAutoSelected.current) return;
    const hasIssueDeepLink = new URLSearchParams(window.location.search).has('issue');
    if (conversations.length === 0 || convId || hasIssueDeepLink || selectedConversation !== null || selectedFeature !== null || selectedProject !== null) return;
    setSelectedConversation(conversations[0].name);
    hasAutoSelected.current = true;
  }, [conversations, convId, selectedConversation, selectedFeature, selectedProject]);

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
      if (convId === String(conv.id) || convId === conv.name) return;
      onConvIdChange(conversationRouteKey(conv));
    }
  }, [selectedConversation, conversations, onConvIdChange, convId]);

  // PAN-2005: apply the cockpit deep-link (/command-deck/<proj>/<issue>) on mount
  // and popstate — select the project and open (or focus) the issue's cockpit tab.
  useEffect(() => {
    if (!cockpitIssue) return;
    // Wait until deck keys are loaded so the project segment normalizes correctly
    // on the FIRST apply (else we'd lock onto the raw repo key and never re-resolve).
    if (registeredProjects.length === 0) return;
    const key = `${cockpitIssue.project}/${cockpitIssue.issue}`;
    if (key === appliedCockpit.current) return;
    appliedCockpit.current = key;
    // Normalize the URL's project segment to a real dashboard deck key — a stale
    // or hand-built link may carry the tracker repo ("eltmon/panopticon-cli")
    // instead of the deck key ("panopticon-cli"); the sync effect then self-corrects
    // the URL once the feature is selected.
    const seg = cockpitIssue.project;
    const tail = seg.includes('/') ? seg.split('/').pop()! : seg;
    const rp = registeredProjects.find(
      (p) => p.key === seg || p.name === seg || p.key === tail || p.name === tail,
    );
    const deckKey = rp ? (rp.name ?? rp.key) : seg;
    setSelectedFeature(cockpitIssue.issue);
    setSelectedConversation(null);
    onSelectProject?.(deckKey);
    openIssueTabIn(deckKey, cockpitIssue.issue, cockpitIssue.issue);
  }, [cockpitIssue, onSelectProject, registeredProjects]);

  // PAN-2005: sync the URL when the selected issue changes (tree click, etc.).
  // Defined after the conversation-route sync above so the issue path wins when
  // both fire on the same selection change (selecting a feature nulls the conv).
  const prevFeatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onCockpitChange) return;
    if (selectedFeature === prevFeatureRef.current) return;
    prevFeatureRef.current = selectedFeature;
    if (selectedFeature && selectedProject) {
      onCockpitChange(selectedProject, selectedFeature);
    }
  }, [selectedFeature, selectedProject, onCockpitChange]);

  // PAN-5293 F-D1: clear the store on unmount or the next mount's URL sync sees a leftover;
  // resetting the deep-link guards lets StrictMode's second effect pass re-apply the link.
  useEffect(() => () => {
    const selection = useCommandDeckSelection.getState();
    selection.setSelectedConversation(null);
    selection.setSelectedFeature(null);
    appliedConvId.current = null;
    appliedCockpit.current = null;
    hasAutoSelected.current = false;
  }, []);

  // Reverse sync from the Stage: clicking an issue pane tab bypasses
  // handleSelectFeature, so mirror the selection here to keep the cockpit URL
  // (/command-deck/<project>/<issue>) following the visible view.
  const handleActiveIssuePane = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
    setSelectedConversation(null);
  }, []);

  // Resolve a session id → its live SessionNode for Stage's session-backed agent panes.
  const resolveSession = useCallback((sessionId: string) =>
    projectsWithSessions
      .flatMap((p) => p.features)
      .flatMap((f) => f.sessions ?? [])
      .find((s) => s.sessionId === sessionId),
  [projectsWithSessions]);


  // Create a conversation (optionally scoped to a project) and open it as an
  // agent tab in the deck. The deck's own refs follow the new conversation so
  // its deep-link and URL-sync effects do not re-apply it.
  const onConversationCreated = useCallback((conv: Conversation) => {
    appliedConvId.current = `${String(conv.id)}::${conversationViewMode ?? 'conversation'}`;
    prevSelectedRef.current = conv.name;
  }, [conversationViewMode]);
  const { createForAgent: createDeckConversation } = useCreateConversation(selectedProject, onConversationCreated);

  // Re-fetch all query caches when the WebSocket transport reconnects after
  // a dashboard restart. Without this, the Command Deck operates on stale
  // data — conversations vanish, session trees freeze, costs go stale.
  useEffect(() => {
    const handler = () => {
      console.log('[CommandDeck] transport reconnected — invalidating query caches');
      queryClient.invalidateQueries();
    };
    window.addEventListener('overdeck:reconnected', handler);
    return () => window.removeEventListener('overdeck:reconnected', handler);
  }, [queryClient]);

  // ── Project-scoped deck data (PAN-1561) ── from useProjectScope above.
  const isNoProject = selectedProject === NO_PROJECT_KEY;

  // PAN-1593: the selected project's single issue prefix (e.g. "PAN"), derived
  // from its issue ids — the same signal ProjectOverview uses. Reported up so the
  // app-bar search can scope to this project. Null when ambiguous/empty.
  const selectedProjectPrefix = useMemo(() => {
    const prefixes = new Set(
      projectIssueIds.map((id) => id.split('-')[0]?.toUpperCase()).filter(Boolean),
    );
    return prefixes.size === 1 ? [...prefixes][0]! : null;
  }, [projectIssueIds]);
  useEffect(() => {
    onProjectPrefixChange?.(selectedProjectPrefix);
  }, [selectedProjectPrefix, onProjectPrefixChange]);

  // Resolve the per-issue data an issue tab's IssueOverview needs.
  const resolveIssue = useCallback(
    (issueId: string) => {
      const key = issueId.toLowerCase();
      const title = issueTitles[key] || issueTitles[issueId] || issueId;
      const createdAt = createdAtByIssue[issueId];
      const branch = selectedProjectData?.features.find(f => f.issueId === issueId)?.branch;
      const agentId = agentIdByIssue[key];
      return { title, createdAt, branch, agentId };
    },
    [issueTitles, createdAtByIssue, selectedProjectData, agentIdByIssue],
  );

  return (
    <div className={styles.commandDeck}>
      <div className={styles.layout}>
        {/* Content Area — the project-scoped deck (PAN-1561) */}
        <div className={styles.content}>
          {conversationRouteError && <p role="alert">{conversationRouteError.message}</p>}
          {isProjectValidationPending ? <ProjectPendingState onRetry={() => void refetchRegisteredProjects()} />
          : registeredProjectsError ? <ProjectRegistryErrorState onRetry={() => void refetchRegisteredProjects()} />
          : showUnknownProject ? (
            <UnknownProjectState project={selectedProject!} registeredProjects={registeredProjects} onSelectProject={onSelectProject} />
          ) : selectedProject ? (
            <Stage
              key={selectedProject}
              deckKey={selectedProject}
              conversations={conversations}
              resolveSession={resolveSession}
              onCreateConversation={createDeckConversation}
              onActiveConversationChange={setSelectedConversation}
              onActiveIssueChange={handleActiveIssuePane}
              terminalCwd={selectedRegisteredProject?.path}
              renderHome={(api) => (
                <ProjectHome
                  projectName={isNoProject ? NO_PROJECT_LABEL : selectedProject}
                  projectKey={selectedRegisteredProject?.key}
                  conversations={projectConvs}
                  onCreateConversation={createDeckConversation}
                  features={visibleFeatures}
                  issueCosts={issueCosts}
                  issueCostDetails={issueCostDetails}
                  onSelectFeature={(feature) => handleSelectFeature(feature.issueId)}
                  api={api}
                />
              )}
              renderIssue={(issueId, api) => {
                const info = resolveIssue(issueId);
                return (
                  <IssueOverview
                    issueId={issueId}
                    title={info.title}
                    branch={info.branch}
                    projectName={selectedProject ?? undefined}
                    createdAt={info.createdAt}
                    agentId={info.agentId}
                    conversations={conversations}
                    onCreateConversation={createDeckConversation}
                    api={api}
                  />
                );
              }}
            />
          ) : (
            <DeckEmptyState onStartWithoutProject={() => onSelectProject?.(NO_PROJECT_KEY)} />
          )}
        </div>
      </div>
    </div>
  );
}
