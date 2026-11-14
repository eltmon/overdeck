import { describe, expect, it } from 'vitest'
import type { AgentSnapshot } from '@overdeck/contracts'
import { buildAgentsWorking } from '../agentsWorking'
import { buildProjectResolver, type ConversationLike, type ResolverProject } from '../projectOf'

type AgentLike = Pick<AgentSnapshot, 'id' | 'status' | 'role' | 'issueId'>

const projects: ResolverProject[] = [
  { key: 'panopticon-cli', name: 'overdeck', path: '/home/u/Projects/overdeck', linearTeam: 'PAN' },
  { key: 'krux', path: '/home/u/Projects/krux', linearTeam: 'KRUX' },
]

function agent(id: string, status: string, extra: Partial<AgentLike> = {}): AgentLike {
  return { id, status, issueId: 'PAN-1', ...extra } as AgentLike
}

describe('buildAgentsWorking (PAN-5287 §6.6)', () => {
  it('counts running, active, starting, thinking and working agents and not stopped or idle ones', () => {
    const agents = ['running', 'active', 'starting', 'thinking', 'working', 'stopped', 'idle'].map((status, i) =>
      agent(`agent-pan-${i}`, status, { issueId: `PAN-${i}` }),
    )
    const result = buildAgentsWorking(agents, [], buildProjectResolver(projects, []))
    expect(result.count).toBe(5)
    expect(result.rows.map((r) => r.id)).toEqual(['agent-pan-0', 'agent-pan-1', 'agent-pan-2', 'agent-pan-3', 'agent-pan-4'])
  })

  it('counts a conv- agent and its working conversation once, as a conversation', () => {
    const conversations: ConversationLike[] = [
      { name: '20261113-6031', tmuxSession: 'conv-20261113-6031', isWorking: true, cwd: '/home/u/Projects/krux' },
    ]
    const agents = [agent('conv-20261113-6031', 'running', { issueId: '' })]
    const result = buildAgentsWorking(agents, conversations, buildProjectResolver(projects, conversations))
    expect(result.count).toBe(1)
    expect(result.rows[0]).toMatchObject({ kind: 'conversation', id: '20261113-6031', role: 'conversation', projectKey: 'krux' })
  })

  it('counts a conversation only when isWorking is true', () => {
    const conversations: ConversationLike[] = [
      { name: 'busy', tmuxSession: 'conv-busy', isWorking: true },
      { name: 'quiet', tmuxSession: 'conv-quiet', isWorking: false },
      { name: 'unknown', tmuxSession: 'conv-unknown' },
    ]
    const result = buildAgentsWorking([], conversations, buildProjectResolver(projects, conversations))
    expect(result.rows.map((r) => r.id)).toEqual(['busy'])
  })

  it('files agents under the project whose prefix matches the issue, case-insensitively', () => {
    const agents = [
      agent('agent-pan-12', 'running', { issueId: 'PAN-12', role: 'work' }),
      agent('agent-pan-13', 'running', { issueId: 'pan-13', role: 'work' }),
      agent('agent-krux-3', 'running', { issueId: 'KRUX-3', role: 'work' }),
    ]
    const result = buildAgentsWorking(agents, [], buildProjectResolver(projects, []), { projectKey: 'panopticon-cli' })
    expect(result.rows.map((r) => r.id)).toEqual(['agent-pan-12', 'agent-pan-13'])
    expect(result.count).toBe(2)
  })

  it('files conversations by projectKey override and by cwd', () => {
    const conversations: ConversationLike[] = [
      { name: 'override', tmuxSession: 'conv-override', isWorking: true, cwd: '/home/u/Projects/krux', projectKey: 'panopticon-cli' },
      { name: 'cwd', tmuxSession: 'conv-cwd', isWorking: true, cwd: '/home/u/Projects/overdeck/src' },
      { name: 'other', tmuxSession: 'conv-other', isWorking: true, cwd: '/home/u/Projects/krux' },
    ]
    const result = buildAgentsWorking([], conversations, buildProjectResolver(projects, conversations), {
      projectKey: 'panopticon-cli',
    })
    expect(result.rows.map((r) => r.id)).toEqual(['override', 'cwd'])
  })

  it('breaks the count down by role, summing to the count', () => {
    const agents = [
      agent('planning-pan-1', 'running', { role: 'plan' }),
      agent('agent-pan-2', 'running', { role: 'work' }),
      agent('review-pan-3', 'running', { role: 'review' }),
      agent('test-pan-4', 'running', { role: 'test' }),
      agent('flywheel', 'running', { role: 'flywheel', issueId: '' }),
      agent('planning-pan-5', 'running', { issueId: 'PAN-5' }),
      agent('agent-pan-6', 'running', { issueId: 'PAN-6' }),
      agent('mystery', 'running', { issueId: '' }),
    ]
    const conversations: ConversationLike[] = [{ name: 'c1', tmuxSession: 'conv-c1', isWorking: true }]
    const result = buildAgentsWorking(agents, conversations, buildProjectResolver(projects, conversations))
    expect(result.byRole).toEqual({ planning: 2, building: 2, review: 1, test: 1, conversation: 1, other: 2 })
    const sum = Object.values(result.byRole).reduce((a, b) => a + b, 0)
    expect(sum).toBe(result.count)
    expect(result.count).toBe(9)
  })

  it('has every role key at zero when nothing is working', () => {
    const result = buildAgentsWorking([], [], buildProjectResolver(projects, []))
    expect(result).toEqual({
      count: 0,
      byRole: { planning: 0, building: 0, review: 0, test: 0, conversation: 0, other: 0 },
      rows: [],
    })
  })
})
