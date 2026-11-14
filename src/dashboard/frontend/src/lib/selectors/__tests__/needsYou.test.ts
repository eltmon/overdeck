import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigateToDecisionSubject = vi.fn()
const requestReopen = vi.fn()

vi.mock('../../navigateToDecision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../navigateToDecision')>()),
  navigateToDecisionSubject: (...args: unknown[]) => navigateToDecisionSubject(...args),
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

beforeEach(() => {
  navigateToDecisionSubject.mockReset()
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
