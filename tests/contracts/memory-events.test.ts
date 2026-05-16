import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { DomainEvent, INITIAL_READ_MODEL_STATE, applyEvent } from '@panctl/contracts'

const TS = '2026-05-15T00:00:00.000Z'
const decode = Schema.decodeUnknownResult(DomainEvent)

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const

const observation = {
  id: 'obs-1',
  timestamp: TS,
  ...identity,
  gitBranch: 'feature/pan-1052',
  sourceTranscriptOffset: 123,
  actionStatus: 'Added memory event contracts',
  narrative: 'Added memory event contracts for the activity feed.',
  summary: 'packages/contracts/src/events.ts defines memory events.',
  files: ['packages/contracts/src/events.ts'],
  tags: ['memory', 'events'],
  tokens: { prompt: 10, completion: 5, total: 15 },
  model: 'stub-model',
}

const status = {
  name: 'Building memory contracts',
  headline: 'Memory contracts are available.',
  summary: 'The shared event contracts are ready for downstream pipeline work.',
  goal: 'Activity feed memory substrate',
  phase: 'building',
  accomplished: ['Added schemas'],
  decided: ['Use explicit identity because branch names are metadata only'],
  open: [],
  nextSteps: ['Wire reducers'],
  confidence: 0.9,
  workingSet: ['packages/contracts/src/events.ts'],
  tags: ['memory'],
} as const

const pendingTurn = {
  id: 'pending-1',
  createdAt: TS,
  identity,
  trigger: 'stop-hook',
  transcriptPath: '/tmp/session.jsonl',
  fromOffset: 0,
  toOffset: 123,
  lastFullLineOffset: 123,
  eventsConsumed: 4,
  compressedText: 'U: build memory events\nA: done',
} as const

const marker = {
  id: 'reset-1',
  scope: 'workspace',
  scopeId: 'feature-pan-1052',
  fromTimestamp: TS,
  reason: 'post-merge cleanup',
  createdAt: TS,
} as const

function event(sequence: number, type: DomainEvent['type'], payload: unknown): DomainEvent {
  return { sequence, timestamp: TS, type, payload } as DomainEvent
}

describe('memory DomainEvent contracts', () => {
  const events: DomainEvent[] = [
    event(1, 'memory.observation_created', { observation }),
    event(2, 'memory.status_updated', {
      identity: { projectId: identity.projectId, workspaceId: identity.workspaceId, issueId: identity.issueId },
      status,
    }),
    event(3, 'memory.rollup_triggered', {
      projectId: identity.projectId,
      workspaceId: identity.workspaceId,
      issueId: identity.issueId,
      pendingTurns: [pendingTurn],
      threshold: 4,
    }),
    event(4, 'memory.reset_marker_created', { marker }),
    event(5, 'memory.health_changed', {
      projectId: identity.projectId,
      issueId: identity.issueId,
      status: 'degraded',
      reason: 'provider timeout',
    }),
  ]

  it('validates all memory event payloads through the DomainEvent union', () => {
    for (const candidate of events) {
      expect(decode(candidate)._tag, candidate.type).toBe('Success')
    }
  })

  it('projects all memory events in the shared reducer', () => {
    const next = events.reduce(applyEvent, INITIAL_READ_MODEL_STATE)

    expect(next.sequence).toBe(5)
    expect(next.memory.observationsByIssueId['PAN-1052']).toEqual([observation])
    expect(next.memory.statusByIssueId['PAN-1052']).toEqual(status)
    expect(next.memory.rollupsByIssueId['PAN-1052']).toEqual([{
      projectId: identity.projectId,
      workspaceId: identity.workspaceId,
      issueId: identity.issueId,
      pendingTurns: [pendingTurn],
      threshold: 4,
      triggeredAt: TS,
    }])
    expect(next.memory.resetMarkersByScopeId['workspace:feature-pan-1052']).toEqual([marker])
    expect(next.memory.healthByIssueId['PAN-1052']).toEqual({
      projectId: identity.projectId,
      issueId: identity.issueId,
      status: 'degraded',
      reason: 'provider timeout',
      ragDecision: undefined,
      updatedAt: TS,
    })
  })
})
