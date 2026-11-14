import { describe, expect, it } from 'vitest'
import { buildProjectResolver, type ConversationLike, type ResolverProject } from '../projectOf'

const projects: ResolverProject[] = [
  { key: 'panopticon-cli', name: 'overdeck', path: '/home/u/Projects/overdeck', linearTeam: 'PAN' },
  { key: 'krux', path: '/home/u/Projects/krux', linearTeam: 'krux' },
  { key: 'notes', path: '/home/u/notes', linearTeam: null },
]

const conversations: ConversationLike[] = [
  { name: 'by-cwd', tmuxSession: 'conv-by-cwd', cwd: '/home/u/Projects/krux/src' },
  { name: 'by-override', tmuxSession: 'conv-by-override', cwd: '/home/u/Projects/krux', projectKey: 'panopticon-cli' },
  { name: 'nowhere', tmuxSession: 'conv-nowhere', cwd: '/tmp' },
]

describe('buildProjectResolver (PAN-5287 §6.6)', () => {
  const resolver = buildProjectResolver(projects, conversations)

  it('maps an issue id to the project whose prefix matches, case-insensitively', () => {
    expect(resolver.issue('PAN-12')).toBe('panopticon-cli')
    expect(resolver.issue('pan-12')).toBe('panopticon-cli')
    expect(resolver.issue('KRUX-3')).toBe('krux')
  })

  it('uses the part before the last -<digits> as the prefix', () => {
    const multi = buildProjectResolver([{ key: 'my-app', path: '/a', linearTeam: 'MY-APP' }], [])
    expect(multi.issue('MY-APP-7')).toBe('my-app')
  })

  it('returns undefined for an unknown prefix or a malformed id', () => {
    expect(resolver.issue('MIN-1')).toBeUndefined()
    expect(resolver.issue('PAN')).toBeUndefined()
  })

  it('resolves a conversation by its cwd', () => {
    expect(resolver.conversation('by-cwd')).toBe('krux')
  })

  it('resolves a conversation by its projectKey override', () => {
    expect(resolver.conversation('by-override')).toBe('panopticon-cli')
  })

  it('finds a conversation by its tmux session, with or without the conv- prefix', () => {
    expect(resolver.conversation('conv-by-cwd')).toBe('krux')
  })

  it('returns undefined for an unknown conversation or one outside every project', () => {
    expect(resolver.conversation('missing')).toBeUndefined()
    expect(resolver.conversation('nowhere')).toBeUndefined()
  })
})
