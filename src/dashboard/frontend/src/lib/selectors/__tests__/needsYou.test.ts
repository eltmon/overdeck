import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigateToDecisionSubject = vi.fn()
const requestReopen = vi.fn()
const openAgentRequestDialog = vi.fn()

vi.mock('../../navigateToDecision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../navigateToDecision')>()),
  navigateToDecisionSubject: (...args: unknown[]) => navigateToDecisionSubject(...args),
}))
vi.mock('../../agentRequestDialogStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agentRequestDialogStore')>()),
  openAgentRequestDialog: (...args: unknown[]) => openAgentRequestDialog(...args),
}))
import type { DerivedIssueState } from '@overdeck/contracts'
import type { PendingInputSubject } from '../../store'
import type { Decision } from '../../useDecisions'
import type { NeedsYouRow } from '../../../components/flywheel/needsYouRows'
import { buildNeedsYouItems, isSubjectUnresolved, type NeedsYouSources } from '../needsYou'
import { useAskUserQuestionUiStore } from '../../askUserQuestionUiStore'
import { buildProjectResolver } from '../projectOf'

const projectOf = buildProjectResolver(
  [
    { key: 'panopticon-cli', name: 'overdeck', path: '/home/u/Projects/overdeck', linearTeam: 'PAN' },
    { key: 'krux', path: '/home/u/Projects/krux', linearTeam: 'KRUX' },
  ],
  [{ name: 'chat-1', tmuxSession: 'conv-chat-1', cwd: '/home/u/Projects/krux' }],
)

const emptyResolution = {
  answeredToolUseIds: new Set<string>(),
  dismissedSubjectIds: new Set<string>(),
  resolvedPlanToolUseIds: new Set<string>(),
  dismissedPlanSubjectIds: new Set<string>(),
}

function sources(overrides: Partial<NeedsYouSources> = {}): NeedsYouSources {
  return {
    subjects: [],
    resolution: emptyResolution,
    derived: {},
    flywheelRows: [],
    decisions: [],
    issueTitles: new Map([['PAN-12', 'Frame seams']]),
    projectOf,
    ...overrides,
  }
}

function subject(agentId: string, extra: Partial<PendingInputSubject> = {}): PendingInputSubject {
  return { agentId, source: 'agent', kinds: ['askUserQuestion'], permissionRequestIds: [], since: '', ...extra }
}

function auq(toolUseId: string, question: string): PendingInputSubject['pendingAskUserQuestion'] {
  return { toolUseId, questions: [{ question }] } as unknown as PendingInputSubject['pendingAskUserQuestion']
}

function decision(id: string, extra: Partial<Decision> = {}): Decision {
  return { id, source: 'agent', label: id, kinds: [], since: '', blocking: false, ...extra }
}

function derived(issueId: string): DerivedIssueState {
  return { issueId, state: 'in-progress', attention: 'needs-you' } as unknown as DerivedIssueState
}

function row(text: string, key: string): NeedsYouRow {
  return { key, text, label: text }
}

function secretRequest(extra: Partial<NonNullable<Decision['agentRequest']>> = {}): NonNullable<Decision['agentRequest']> {
  return { id: 'req-1', kind: 'secret', name: 'OPENAI_API_KEY', prompt: 'p', agentId: 'agent-pan-7', agentKind: 'agent', issueId: 'PAN-7', expiresAt: '', ...extra }
}

beforeEach(() => {
  navigateToDecisionSubject.mockReset()
  openAgentRequestDialog.mockReset()
  requestReopen.mockReset()
  useAskUserQuestionUiStore.setState({ requestReopen })
})

describe('buildNeedsYouItems (PAN-5287 §6.5)', () => {
  it('drops a subject whose AskUserQuestion was answered', () => {
    const s = subject('agent-pan-12', { issueId: 'PAN-12', pendingAskUserQuestion: auq('tu-1', 'Which way?') })
    const resolution = { ...emptyResolution, answeredToolUseIds: new Set(['tu-1']) }
    expect(isSubjectUnresolved(s, resolution)).toBe(false)
    expect(buildNeedsYouItems(sources({ subjects: [s], resolution }))).toEqual([])
  })

  it('folds two subjects on one issue and its needs-you attention into one item', () => {
    const items = buildNeedsYouItems(
      sources({
        subjects: [
          subject('review-pan-12-a', { issueId: 'PAN-12', pendingAskUserQuestion: auq('tu-a', 'Approve the plan?'), since: '2026-11-14T10:00:00Z' }),
          subject('review-pan-12-b', { issueId: 'pan-12', pendingAskUserQuestion: auq('tu-b', 'Second?') }),
        ],
        derived: { 'PAN-12': derived('PAN-12') },
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'issue:PAN-12', kind: 'pending-input', ask: 'Approve the plan?', projectKey: 'panopticon-cli' })
    expect(items[0].title).toContain('PAN-12')
  })

  it('folds a flywheel row naming an issue into that issue and sets its ask', () => {
    const items = buildNeedsYouItems(
      sources({ derived: { 'PAN-12': derived('PAN-12') }, flywheelRows: [row('Merge PAN-12 needs you', 'merge-pan-12')] }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'issue:PAN-12', kind: 'issue', ask: 'Merge PAN-12 needs you' })
  })

  it('keeps a flywheel row without an issue id as its own item', () => {
    const items = buildNeedsYouItems(sources({ flywheelRows: [row('Approve the restart', 'approve-the-restart')] }))
    expect(items).toEqual([
      expect.objectContaining({ key: 'flywheel:approve-the-restart', kind: 'flywheel', title: 'Flywheel', ask: 'Approve the restart' }),
    ])
  })

  it('lists disk-alert and fleet decisions once and never duplicates a pending-input subject', () => {
    const s = subject('agent-pan-12', { issueId: 'PAN-12', pendingAskUserQuestion: auq('tu-1', 'Which way?') })
    const items = buildNeedsYouItems(
      sources({
        subjects: [s],
        decisions: [
          decision('agent-pan-12', { issueId: 'PAN-12', kinds: ['askUserQuestion'] }),
          decision('disk-alert', { label: 'Disk space', kinds: ['diskCritical'] }),
          decision('@laptop/agent-krux-3', { label: 'KRUX-3', remote: true, machineLabel: 'laptop' }),
          decision('disk-alert', { label: 'Disk space', kinds: ['diskCritical'] }),
        ],
      }),
    )
    expect(items.map((i) => i.key)).toEqual(['issue:PAN-12', 'decision:disk-alert', 'decision:@laptop/agent-krux-3'])
  })

  it('keeps only the matching project when filtering, dropping decision items', () => {
    const items = buildNeedsYouItems(
      sources({
        subjects: [
          subject('agent-pan-12', { issueId: 'PAN-12' }),
          subject('chat-1', { source: 'conversation', kinds: ['permissionRequest'] }),
        ],
        derived: { 'KRUX-3': derived('KRUX-3') },
        decisions: [decision('disk-alert', { kinds: ['diskCritical'] })],
      }),
      { projectKey: 'panopticon-cli' },
    )
    expect(items.map((i) => i.key)).toEqual(['issue:PAN-12'])
    const krux = buildNeedsYouItems(
      sources({
        subjects: [subject('chat-1', { source: 'conversation', kinds: ['permissionRequest'] })],
        derived: { 'KRUX-3': derived('KRUX-3') },
      }),
      { projectKey: 'krux' },
    )
    expect(krux.map((i) => i.key)).toEqual(['conversation:chat-1', 'issue:KRUX-3'])
  })

  it('orders dated items oldest first, then the rest in insertion order', () => {
    const items = buildNeedsYouItems(
      sources({
        subjects: [
          subject('a', { since: '2026-11-14T12:00:00Z' }),
          subject('b'),
          subject('c', { since: '2026-11-14T09:00:00Z' }),
        ],
      }),
    )
    expect(items.map((i) => i.key)).toEqual(['agent:c', 'agent:a', 'agent:b'])
  })

  it('opens a pending-input item by navigating to its subject and reopening its dialog', () => {
    const s = subject('agent-pan-12', { issueId: 'PAN-12', pendingAskUserQuestion: auq('tu-1', 'Which way?') })
    const [item] = buildNeedsYouItems(sources({ subjects: [s] }))
    item.open()
    expect(navigateToDecisionSubject).toHaveBeenCalledWith({ id: 'agent-pan-12', source: 'agent', issueId: 'PAN-12' })
    expect(requestReopen).toHaveBeenCalledWith('agent-pan-12')
  })

  it('sends a non-answerable conversation permission straight to the terminal', () => {
    const s = subject('chat-1', { source: 'conversation', kinds: ['permissionRequest'], permissionAnswerable: false })
    const [item] = buildNeedsYouItems(sources({ subjects: [s] }))
    item.open()
    expect(navigateToDecisionSubject).toHaveBeenCalledWith({ id: 'chat-1', source: 'conversation', view: 'terminal' })
    expect(requestReopen).not.toHaveBeenCalled()
  })
})

describe('buildNeedsYouItems agent requests (PAN-5541)', () => {
  it('opens the dialog store with the request id, never navigating or pushing history (AC1)', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const [item] = buildNeedsYouItems(sources({ decisions: [decision('req-1', { agentRequest: secretRequest() })] }))
    item.open()
    expect(openAgentRequestDialog).toHaveBeenCalledWith('req-1')
    expect(navigateToDecisionSubject).not.toHaveBeenCalled()
    expect(pushState).not.toHaveBeenCalled()
    pushState.mockRestore()
  })

  it('asks "Secret requested: <NAME>" for a secret and "Machine link requested: <hint>" for a machine link', () => {
    const items = buildNeedsYouItems(
      sources({
        decisions: [
          decision('req-1', { agentRequest: secretRequest() }),
          decision('req-2', { agentRequest: { ...secretRequest(), id: 'req-2', kind: 'machine-link', hint: 'my desk Mac' } }),
        ],
      }),
    )
    expect(items.map((i) => i.ask)).toEqual(['Secret requested: OPENAI_API_KEY', 'Machine link requested: my desk Mac'])
  })

  it("files a conversation owner's request under the conversation's project (AC2)", () => {
    const [item] = buildNeedsYouItems(
      sources({ decisions: [decision('req-1', { agentRequest: { ...secretRequest(), agentId: 'chat-1', agentKind: 'conversation', issueId: null } })] }),
    )
    expect(item).toMatchObject({ projectKey: 'krux' })
  })

  it("files an agent owner's request under projectOf.issue(issueId) (AC2)", () => {
    const [item] = buildNeedsYouItems(sources({ decisions: [decision('req-1', { agentRequest: secretRequest({ issueId: 'PAN-7' }) })] }))
    expect(item).toMatchObject({ projectKey: 'panopticon-cli' })
  })

  it('files no projectKey for an agent owner with no issue id', () => {
    const [item] = buildNeedsYouItems(sources({ decisions: [decision('req-1', { agentRequest: secretRequest({ issueId: null }) })] }))
    expect(item.projectKey).toBeUndefined()
  })

  it('keeps the agent-request item when filtering to its project (AC3)', () => {
    const items = buildNeedsYouItems(
      sources({ decisions: [decision('req-1', { agentRequest: secretRequest({ issueId: 'PAN-7' }) })] }),
      { projectKey: 'panopticon-cli' },
    )
    expect(items.map((i) => i.key)).toEqual(['decision:req-1'])
  })
})
