import { describe, expect, it } from 'vitest'
import type { WorkspacePane } from '../../../lib/panesStore'
import type { Conversation } from '../../CommandDeck/ConversationList'
import { NO_PROJECT_KEY } from '../../CommandDeck/projectsData'
import type { RootContext } from '../../explorer/rootForConversation'
import { deriveDockScope, type DockScopeInput } from '../dockScope'

const ctx: RootContext = {
  projects: [
    { key: 'p', name: 'Project P', path: '/home/u/Projects/p' },
    { key: 'over', name: 'Overdeck', path: '/home/u/Projects/overdeck' },
  ],
  workspaces: [{ id: 'w1', projectId: 'p', kind: 'scratch', name: 'Edit one', issueId: null }],
}

function conv(fields: Partial<Conversation> & { name: string }): Conversation {
  return { cwd: '/home/u/Projects/p', issueId: null, title: 'Fix the bug', branch: 'main', ...fields } as Conversation
}

function pane(fields: Partial<WorkspacePane> & { paneId: string; paneType: WorkspacePane['paneType'] }): WorkspacePane {
  return { label: fields.paneId, createdAt: 0, ...fields }
}

function input(over: Partial<DockScopeInput>): DockScopeInput {
  const panes = over.panesById ?? new Map<string, WorkspacePane>()
  return {
    activePane: null,
    layoutLeafIds: [...panes.keys()],
    panesById: panes,
    deckKey: 'p',
    conversations: [],
    rootContext: ctx,
    ...over,
  }
}

const chatPane = pane({ paneId: 'a1', paneType: 'agent', conversationId: 'c1' })
const c1 = conv({ name: 'c1' })

describe('deriveDockScope', () => {
  it('rule 2: a conversation in the project folder scopes to the project root', () => {
    const scope = deriveDockScope(input({ activePane: chatPane, conversations: [c1] }))
    expect(scope.rootId).toBe('project:p')
    expect(scope.changes).toEqual({ kind: 'conversation', conversation: c1 })
    expect(scope.header).toEqual({ kind: 'conversation', title: 'Fix the bug', branch: 'main' })
    expect(scope.overridden).toBe(false)
    expect(scope.deckRootId).toBe('project:p')
  })

  it('rule 2: an untitled conversation is "New conversation" with no branch', () => {
    const untitled = conv({ name: 'c1', title: '  ', branch: undefined })
    const scope = deriveDockScope(input({ activePane: chatPane, conversations: [untitled] }))
    expect(scope.header).toEqual({ kind: 'conversation', title: 'New conversation', branch: null })
  })

  it('rule 2: a linked or an outside conversation has a null root with its reason', () => {
    const linked = deriveDockScope(input({ activePane: chatPane, conversations: [conv({ name: 'c1', origin: 'linked' } as Partial<Conversation> & { name: string })] }))
    expect(linked.rootId).toBeNull()
    expect(linked.nullReason).toBe('linked')
    const outside = deriveDockScope(input({ activePane: chatPane, conversations: [conv({ name: 'c1', cwd: '/srv/elsewhere' })] }))
    expect(outside.rootId).toBeNull()
    expect(outside.nullReason).toBe('outside')
    expect(outside.changes.kind).toBe('conversation')
  })

  it('rule 6: the no-project deck on Home has a null root with reason no-project', () => {
    const home = pane({ paneId: 'home', paneType: 'home', isPermanent: true })
    const scope = deriveDockScope(input({ activePane: home, deckKey: NO_PROJECT_KEY }))
    expect(scope).toMatchObject({ rootId: null, nullReason: 'no-project', changes: { kind: 'none' }, header: { kind: 'none' }, deckRootId: null })
  })

  it('rule 6: a deck keyed by a project name resolves to that project key', () => {
    const home = pane({ paneId: 'home', paneType: 'home' })
    const scope = deriveDockScope(input({ activePane: home, deckKey: 'Overdeck' }))
    expect(scope.rootId).toBe('project:over')
    expect(scope.deckRootId).toBe('project:over')
    expect(scope.changes).toEqual({ kind: 'project-main', projectKey: 'over' })
    expect(scope.header).toEqual({ kind: 'project' })
    expect(scope.overridden).toBe(false)
  })

  it('rule 6: no active pane falls back to the deck root', () => {
    expect(deriveDockScope(input({})).rootId).toBe('project:p')
  })

  it('rule 3: a pipeline-session agent pane scopes to its issue, upper-cased', () => {
    const session = pane({ paneId: 's1', paneType: 'agent', agentId: 'agent-pan-7', issueId: 'pan-7' })
    const scope = deriveDockScope(input({ activePane: session }))
    expect(scope.rootId).toBe('issue:PAN-7')
    expect(scope.changes).toEqual({ kind: 'root', rootId: 'issue:PAN-7' })
    expect(scope.header).toEqual({ kind: 'issue', issueId: 'PAN-7' })
  })

  it('rule 4: an issue pane scopes to its issue', () => {
    const issue = pane({ paneId: 'i1', paneType: 'issue', issueId: 'PAN-9' })
    expect(deriveDockScope(input({ activePane: issue })).rootId).toBe('issue:PAN-9')
  })

  it('rule 5: a code pane beside a conversation leaf reveals its file and shows the conversation changes', () => {
    const code = pane({ paneId: 'k1', paneType: 'code', explorerRootId: 'project:p', explorerPath: 'src/a.ts' })
    const panes = new Map([
      ['k1', code],
      ['a1', chatPane],
    ])
    const scope = deriveDockScope(input({ activePane: code, panesById: panes, layoutLeafIds: ['k1', 'a1'], conversations: [c1] }))
    expect(scope.rootId).toBe('project:p')
    expect(scope.revealPath).toBe('src/a.ts')
    expect(scope.changes).toEqual({ kind: 'conversation', conversation: c1 })
    expect(scope.header).toEqual({ kind: 'project' })
  })

  it('rule 5: a code pane on an issue root without a conversation leaf shows the root changes', () => {
    const code = pane({ paneId: 'k1', paneType: 'code', explorerRootId: 'issue:X', explorerPath: 'b.ts' })
    const scope = deriveDockScope(input({ activePane: code, panesById: new Map([['k1', code]]), layoutLeafIds: ['k1'] }))
    expect(scope.changes).toEqual({ kind: 'root', rootId: 'issue:X' })
    expect(scope.header).toEqual({ kind: 'issue', issueId: 'X' })
  })

  it('rule 1: an override anchored to the active pane wins; anchored elsewhere the pane rules apply', () => {
    const anchored = deriveDockScope(input({ activePane: chatPane, conversations: [c1], rootOverride: 'workspace:w1', rootOverrideAnchor: 'a1' }))
    expect(anchored.rootId).toBe('workspace:w1')
    expect(anchored.changes).toEqual({ kind: 'root', rootId: 'workspace:w1' })
    expect(anchored.header).toEqual({ kind: 'workspace' })
    expect(anchored.overridden).toBe(true)
    const elsewhere = deriveDockScope(input({ activePane: chatPane, conversations: [c1], rootOverride: 'workspace:w1', rootOverrideAnchor: 'other' }))
    expect(elsewhere.rootId).toBe('project:p')
    expect(elsewhere.overridden).toBe(false)
  })

  it('rule 1: an unanchored override applies to every pane and maps project roots to project-main', () => {
    const scope = deriveDockScope(input({ activePane: chatPane, conversations: [c1], rootOverride: 'project:over' }))
    expect(scope.rootId).toBe('project:over')
    expect(scope.changes).toEqual({ kind: 'project-main', projectKey: 'over' })
    expect(scope.header).toEqual({ kind: 'project' })
  })
})
