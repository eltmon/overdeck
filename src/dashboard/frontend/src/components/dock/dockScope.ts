// What the work dock shows for the active Stage pane (PAN-5289 §6.2, WI-3).
//
// `deriveDockScope` is pure: given the active pane, the deck's layout, the
// conversations and the project/workspace registry, it returns the explorer
// root the Files and Search tabs show, the data source of the Changes tab and
// the header the scope line renders. Rules, first match wins:
//
// 1. A root override the operator picked, while its anchor pane is active (B-D17).
// 2. An agent pane bound to a known conversation: that conversation's root.
// 3. An agent pane of a pipeline session (agentId + issueId): the issue root.
// 4. An issue pane: the issue root.
// 5. A code pane: its root and file; Changes follows the first conversation
//    leaf of the layout (B-D10), else the root kind.
// 6. Anything else: the deck's own project root (B-D11), or none.
//
// No React here; WorkDock calls it with live data.

import type { WorkspacePane } from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'
import { findRegisteredProject } from '../CommandDeck/UnknownProjectState'
import { rootIdForConversation, type RootContext } from '../explorer/rootForConversation'

export type DockRootNullReason = 'linked' | 'outside' | 'no-project'

export type DockChanges =
  | { kind: 'conversation'; conversation: Conversation }
  /** Issue or edit-workspace root: explorer gitStatus. */
  | { kind: 'root'; rootId: string }
  /** Project root: today's commits on the default branch. */
  | { kind: 'project-main'; projectKey: string }
  | { kind: 'none' }

export type DockHeader =
  | { kind: 'conversation'; title: string; branch: string | null }
  | { kind: 'issue'; issueId: string }
  | { kind: 'workspace' }
  | { kind: 'project' }
  | { kind: 'none' }

export interface DockScope {
  rootId: string | null
  nullReason?: DockRootNullReason
  /** Root path to reveal and select in the Files tab (active code pane). */
  revealPath?: string
  changes: DockChanges
  header: DockHeader
  /** The deck's own project root, or null (B-D11). Used by "Open project files". */
  deckRootId: string | null
  /** True when a root override (rule 1) applied. */
  overridden: boolean
}

export interface DockScopeInput {
  activePane: WorkspacePane | null
  layoutLeafIds: readonly string[]
  panesById: ReadonlyMap<string, WorkspacePane>
  deckKey: string
  conversations: readonly Conversation[]
  rootContext: RootContext
  rootOverride?: string
  /** Pane id the override belongs to (B-D17); undefined applies to every pane. */
  rootOverrideAnchor?: string
}

function rootKind(rootId: string): { kind: string; value: string } {
  const sep = rootId.indexOf(':')
  return sep <= 0 ? { kind: '', value: rootId } : { kind: rootId.slice(0, sep), value: rootId.slice(sep + 1) }
}

/** Changes and header for a root id by its kind (rules 1 and 5). */
function byRootKind(rootId: string): { changes: DockChanges; header: DockHeader } {
  const { kind, value } = rootKind(rootId)
  if (kind === 'project') return { changes: { kind: 'project-main', projectKey: value }, header: { kind: 'project' } }
  if (kind === 'issue') return { changes: { kind: 'root', rootId }, header: { kind: 'issue', issueId: value } }
  if (kind === 'workspace') return { changes: { kind: 'root', rootId }, header: { kind: 'workspace' } }
  return { changes: { kind: 'root', rootId }, header: { kind: 'none' } }
}

function conversationOf(pane: WorkspacePane | undefined | null, conversations: readonly Conversation[]): Conversation | undefined {
  if (!pane || pane.paneType !== 'agent' || !pane.conversationId) return undefined
  return conversations.find((c) => c.name === pane.conversationId)
}

function issueScope(issueId: string, deckRootId: string | null): DockScope {
  const id = issueId.toUpperCase()
  const rootId = `issue:${id}`
  return { rootId, changes: { kind: 'root', rootId }, header: { kind: 'issue', issueId: id }, deckRootId, overridden: false }
}

export function deriveDockScope(input: DockScopeInput): DockScope {
  const { activePane, layoutLeafIds, panesById, deckKey, conversations, rootContext, rootOverride, rootOverrideAnchor } = input
  const deckProject = findRegisteredProject(rootContext.projects, deckKey)
  const deckRootId = deckProject ? `project:${deckProject.key}` : null

  // 1. Root override, while its anchor pane is active (B-D17).
  if (rootOverride && (rootOverrideAnchor === undefined || rootOverrideAnchor === activePane?.paneId)) {
    return { rootId: rootOverride, ...byRootKind(rootOverride), deckRootId, overridden: true }
  }

  // 2. A conversation agent pane.
  const conversation = conversationOf(activePane, conversations)
  if (conversation) {
    const rootId = rootIdForConversation(conversation, rootContext)
    const scope: DockScope = {
      rootId,
      changes: { kind: 'conversation', conversation },
      header: { kind: 'conversation', title: conversation.title?.trim() || 'New conversation', branch: conversation.branch ?? null },
      deckRootId,
      overridden: false,
    }
    if (rootId === null) scope.nullReason = conversation.origin === 'linked' ? 'linked' : 'outside'
    return scope
  }

  // 3. A pipeline-session agent pane; 4. an issue pane.
  if (activePane?.paneType === 'agent' && activePane.agentId && activePane.issueId) return issueScope(activePane.issueId, deckRootId)
  if (activePane?.paneType === 'issue' && activePane.issueId) return issueScope(activePane.issueId, deckRootId)

  // 5. A code pane: its root and file; Changes follows a conversation leaf beside it (B-D10).
  if (activePane?.paneType === 'code' && activePane.explorerRootId) {
    const rootId = activePane.explorerRootId
    const kinds = byRootKind(rootId)
    let changes = kinds.changes
    for (const leafId of layoutLeafIds) {
      if (leafId === activePane.paneId) continue
      const leafConversation = conversationOf(panesById.get(leafId), conversations)
      if (leafConversation) {
        changes = { kind: 'conversation', conversation: leafConversation }
        break
      }
    }
    const scope: DockScope = { rootId, changes, header: kinds.header, deckRootId, overridden: false }
    if (activePane.explorerPath) scope.revealPath = activePane.explorerPath
    return scope
  }

  // 6. Everything else: the deck's project root.
  if (deckProject && deckRootId) {
    return { rootId: deckRootId, changes: { kind: 'project-main', projectKey: deckProject.key }, header: { kind: 'project' }, deckRootId, overridden: false }
  }
  return { rootId: null, nullReason: 'no-project', changes: { kind: 'none' }, header: { kind: 'none' }, deckRootId: null, overridden: false }
}
