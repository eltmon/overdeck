/**
 * ConversationsSection — the left column's conversation list for the selected
 * project (PAN-5293 F-D13). An eyebrow header with an Active / All N switch
 * (persisted per viewer, default Active), then the shared ConversationList:
 * Active shows Needs you and Inbox; All adds Snoozed and Settled. Clicking a
 * row opens it in the deck from any route.
 *
 * PAN-5343 H-D2: a This project / All projects switch under the header is the
 * second door into the All projects deck. In that deck the list shows every
 * project's conversations.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ConversationList, type Conversation } from '../CommandDeck/ConversationList';
import type { ConversationProjectRef } from '../CommandDeck/conversationProjectGroups';
import {
  ALL_PROJECTS_KEY, ALL_PROJECTS_LABEL, fetchProjects, isRealProjectKey, NO_PROJECT_KEY, NO_PROJECT_LABEL, resolveEffectiveProjectKey,
} from '../CommandDeck/projectsData';
import { fetchRegisteredProjects, type RegisteredProject } from '../CommandDeck/UnknownProjectState';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { readLastProjectKey } from '../../lib/lastProject';
import { selectDeckLayout, useDeckLayoutStore } from '../../lib/deckLayoutStore';
import { collectLeafIds, leafCount, type PaneLayout } from '../../lib/paneLayout';
import { selectPanesForWorkspace, usePanesStore, type WorkspacePane } from '../../lib/panesStore';
import { useDeckNavigation } from './deck/deckNavigation';
import { useOpenConversation, useOpenConversationBeside } from './deck/useOpenConversation';
import { useProjectScope } from './deck/useProjectScope';

export const CONVERSATION_SCOPE_STORAGE_KEY = 'overdeck.ui.leftColumnConversationScope';

export type ConversationScope = 'active' | 'all';

function readScope(): ConversationScope {
  try {
    return localStorage.getItem(CONVERSATION_SCOPE_STORAGE_KEY) === 'all' ? 'all' : 'active';
  } catch {
    return 'active';
  }
}

const EMPTY_REGISTERED: RegisteredProject[] = [];
const NO_PROJECT_REF: ConversationProjectRef = { key: NO_PROJECT_KEY, label: NO_PROJECT_LABEL };

/**
 * PAN-5343 H-D18: conversation name → its 1-based split leaf, only while the
 * deck shows two or more leaves. Agent panes only.
 */
export function paneSlotsFor(
  layout: PaneLayout | null,
  panes: readonly WorkspacePane[],
): ReadonlyMap<string, number> | undefined {
  if (!layout || leafCount(layout) < 2) return undefined;
  const byId = new Map(panes.map((pane) => [pane.paneId, pane]));
  const slots = new Map<string, number>();
  collectLeafIds(layout).forEach((paneId, index) => {
    const pane = byId.get(paneId);
    if (pane?.paneType === 'agent' && pane.conversationId) slots.set(pane.conversationId, index + 1);
  });
  return slots.size > 0 ? slots : undefined;
}

function SegmentButton({ pressed, onClick, children, testId }: { pressed: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${pressed ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

export function ConversationsSection({ selectedProject }: { selectedProject: string | null }) {
  const [scope, setScopeState] = useState<ConversationScope>(readScope);
  const setScope = useCallback((next: ConversationScope) => {
    setScopeState(next);
    try { localStorage.setItem(CONVERSATION_SCOPE_STORAGE_KEY, next); } catch { /* storage unavailable: the choice holds for this view */ }
  }, []);
  const { conversations, projectConvs, projectConvIdSet, resolveConversationProjectName } = useProjectScope(selectedProject);
  // PAN-5343 H-D8: rows drag onto Stage panes, tagged with their own project deck.
  const deckKeyOf = useCallback(
    (conv: Conversation) => resolveConversationProjectName(conv) ?? NO_PROJECT_KEY,
    [resolveConversationProjectName],
  );
  const selectedConversation = useCommandDeckSelection((s) => s.selectedConversation);
  const openConversation = useOpenConversation(selectedProject);
  // PAN-5343 H-D5: Ctrl/Cmd+Click and Beside open beside; Open in its project switches decks.
  const openConversationBesideInDeck = useOpenConversationBeside(selectedProject);
  const openConversationInProject = useOpenConversation(null);
  const { selectProject } = useDeckNavigation();
  // The switcher's project list, read from its cache (no polling of its own).
  const { data: projects = [] } = useQuery({ queryKey: ['command-deck-projects'], queryFn: fetchProjects, staleTime: Infinity });
  const allProjects = selectedProject === ALL_PROJECTS_KEY;
  // The deck's in-memory layout and panes; the list never hydrates storage itself.
  const deckLayout = useDeckLayoutStore(selectDeckLayout(selectedProject ?? ''));
  const deckPanes = usePanesStore(selectPanesForWorkspace(selectedProject ?? ''));
  const paneSlots = useMemo(() => paneSlotsFor(deckLayout, deckPanes), [deckLayout, deckPanes]);
  // PAN-5343 H-D3: group the All projects list by registered project (same
  // key as the switcher, so the marks match its colors).
  const { data: registeredProjects = EMPTY_REGISTERED } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });
  const groupByProject = useCallback((conv: Conversation): ConversationProjectRef => {
    const key = resolveEffectiveProjectKey(conv, registeredProjects);
    const project = key ? registeredProjects.find((p) => p.key === key) : undefined;
    return project ? { key: project.key, label: project.name ?? project.key } : NO_PROJECT_REF;
  }, [registeredProjects]);
  const showThisProject = () => {
    const last = readLastProjectKey();
    selectProject(isRealProjectKey(last) ? last : projects[0]?.name ?? NO_PROJECT_KEY);
  };

  return (
    <section aria-label="Conversations" data-testid="left-conversations">
      <div className="flex items-center gap-2 px-2 pt-2 pb-1">
        <h2 className="eyebrow flex-1">Conversations</h2>
        <div role="group" aria-label="Conversation scope" className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <SegmentButton testId="conversation-scope-active" pressed={scope === 'active'} onClick={() => setScope('active')}>Active</SegmentButton>
          <SegmentButton testId="conversation-scope-all" pressed={scope === 'all'} onClick={() => setScope('all')}>
            All {allProjects ? conversations.length : projectConvs.length}
          </SegmentButton>
        </div>
      </div>
      <div className="px-2 pb-1">
        <div role="group" aria-label="Conversation deck" className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <SegmentButton testId="conversation-deck-scope-project" pressed={!allProjects} onClick={() => { if (allProjects) showThisProject(); }}>
            This project
          </SegmentButton>
          <SegmentButton testId="conversation-deck-scope-all" pressed={allProjects} onClick={() => { if (!allProjects) selectProject(ALL_PROJECTS_KEY); }}>
            {ALL_PROJECTS_LABEL}
          </SegmentButton>
        </div>
      </div>
      <ConversationList
        selectedConversation={selectedConversation}
        onSelectConversation={openConversation}
        includeIds={allProjects ? undefined : projectConvIdSet}
        groupByProject={allProjects ? groupByProject : undefined}
        paneSlots={paneSlots}
        onOpenBeside={openConversationBesideInDeck}
        onOpenInProject={openConversationInProject}
        deckKeyOf={deckKeyOf}
        scope={scope}
      />
    </section>
  );
}
