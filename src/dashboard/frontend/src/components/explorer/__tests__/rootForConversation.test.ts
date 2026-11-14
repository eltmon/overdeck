import { describe, expect, it } from 'vitest'
import { rootIdForConversation, rootLabelFor, type RootContext } from '../rootForConversation'

const ctx: RootContext = {
  projects: [
    { key: 'panopticon-cli', name: 'overdeck', path: '/home/u/Projects/overdeck', linearTeam: 'PAN' },
    { key: 'krux', path: '/home/u/Projects/krux/', linearTeam: 'KRUX' },
    { key: 'krux-web', name: 'Krux web', path: '/home/u/Projects/krux/web' },
  ],
  workspaces: [
    { id: 'ws-1', projectId: 'krux', kind: 'scratch', name: 'Sketch', issueId: null },
    { id: 'ws-main', projectId: 'panopticon-cli', kind: 'main', name: 'overdeck', issueId: null },
    { id: 'ws-issue', projectId: 'panopticon-cli', kind: 'issue', name: 'feature-pan-9', issueId: 'pan-9' },
  ],
}

const labelCtx = { ...ctx, issueTitles: new Map([['PAN-12', 'Add the frame seams for the workflow redesign children']]) }

describe('rootIdForConversation (PAN-5287 §6.4)', () => {
  it('returns null for a linked conversation even when its cwd matches a project', () => {
    expect(rootIdForConversation({ origin: 'linked', cwd: '/home/u/Projects/overdeck', issueId: 'PAN-1' }, ctx)).toBeNull()
  })

  it('maps an issue id to the upper-cased issue root', () => {
    expect(rootIdForConversation({ issueId: 'pan-12', cwd: '/elsewhere' }, ctx)).toBe('issue:PAN-12')
  })

  it('maps a scratch workspace row to its workspace root', () => {
    expect(rootIdForConversation({ workspaceId: 'ws-1' }, ctx)).toBe('workspace:ws-1')
  })

  it('maps a main workspace row to its project root', () => {
    expect(rootIdForConversation({ workspaceId: 'ws-main' }, ctx)).toBe('project:panopticon-cli')
  })

  it('maps an issue workspace row to its issue root', () => {
    expect(rootIdForConversation({ workspaceId: 'ws-issue' }, ctx)).toBe('issue:PAN-9')
  })

  it('maps a cwd equal to the project path to the project root', () => {
    expect(rootIdForConversation({ cwd: '/home/u/Projects/overdeck' }, ctx)).toBe('project:panopticon-cli')
    expect(rootIdForConversation({ cwd: '/home/u/Projects/overdeck/' }, ctx)).toBe('project:panopticon-cli')
  })

  it('maps a cwd inside the primary checkout to the project root', () => {
    expect(rootIdForConversation({ cwd: '/home/u/Projects/overdeck/src/lib' }, ctx)).toBe('project:panopticon-cli')
  })

  it('maps a cwd in a feature workspace to the issue root', () => {
    expect(rootIdForConversation({ cwd: '/home/u/Projects/overdeck/workspaces/feature-pan-77/src' }, ctx)).toBe('issue:PAN-77')
    expect(rootIdForConversation({ cwd: '/home/u/Projects/overdeck/workspaces/feature-pan-77' }, ctx)).toBe('issue:PAN-77')
  })

  it('returns null for another folder under the workspaces folder', () => {
    expect(rootIdForConversation({ cwd: '/home/u/Projects/overdeck/workspaces/scratch-x' }, ctx)).toBeNull()
  })

  it('returns null for a cwd outside every project', () => {
    expect(rootIdForConversation({ cwd: '/home/u/Projects/overdeck-other' }, ctx)).toBeNull()
    expect(rootIdForConversation({ cwd: '/tmp' }, ctx)).toBeNull()
    expect(rootIdForConversation({}, ctx)).toBeNull()
  })

  it('picks the longest project path for nested projects', () => {
    expect(rootIdForConversation({ cwd: '/home/u/Projects/krux/web/src' }, ctx)).toBe('project:krux-web')
    expect(rootIdForConversation({ cwd: '/home/u/Projects/krux/api' }, ctx)).toBe('project:krux')
  })
})

describe('rootLabelFor (PAN-5287 §6.4)', () => {
  it('labels a project root with its name, never the panopticon-cli key', () => {
    expect(rootLabelFor('project:panopticon-cli', labelCtx)).toBe('overdeck')
  })

  it('labels a project without a name with its key', () => {
    expect(rootLabelFor('project:krux', labelCtx)).toBe('krux')
  })

  it('labels an issue root with its id and a truncated title', () => {
    expect(rootLabelFor('issue:PAN-12', labelCtx)).toBe('PAN-12 · Add the frame seams for the workflow red…')
  })

  it('labels an issue root without a known title with its id', () => {
    expect(rootLabelFor('issue:PAN-99', labelCtx)).toBe('PAN-99')
  })

  it('labels a workspace root with its row name, or Edit workspace when the row is missing', () => {
    expect(rootLabelFor('workspace:ws-1', labelCtx)).toBe('Sketch')
    expect(rootLabelFor('workspace:ws-gone', labelCtx)).toBe('Edit workspace')
  })

  it('returns an unparseable id as given', () => {
    expect(rootLabelFor('nonsense', labelCtx)).toBe('nonsense')
    expect(rootLabelFor('other:thing', labelCtx)).toBe('other:thing')
  })
})
