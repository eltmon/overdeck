import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  determineModel: vi.fn(),
  resolveSingleWorkTierSpawnParams: vi.fn(),
}))

vi.mock('../provider-env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../provider-env.js')>()),
  determineModel: mocks.determineModel,
}))
vi.mock('../spawn-prep.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../spawn-prep.js')>()),
  resolveSingleWorkTierSpawnParams: mocks.resolveSingleWorkTierSpawnParams,
}))

import { resolveRoutedSpawnModel } from '../recovery.js'

describe('resolveRoutedSpawnModel (PAN-4145)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes a work agent through the single-work tier resolver, keyed like spawnAgent', () => {
    mocks.resolveSingleWorkTierSpawnParams.mockReturnValue({ model: 'gpt-5.5' })
    mocks.determineModel.mockImplementation((opts: { model?: string }) => opts.model ?? 'role-default')

    expect(resolveRoutedSpawnModel({ role: 'work', issueId: 'PAN-1', workspace: '/ws/feature-pan-1' })).toBe('gpt-5.5')
    expect(mocks.resolveSingleWorkTierSpawnParams).toHaveBeenCalledWith('/ws/feature-pan-1', undefined, 'work:PAN-1')
    expect(mocks.determineModel).toHaveBeenCalledWith({ model: 'gpt-5.5', role: 'work', spawnKey: 'work:PAN-1' })
  })

  it('falls back to roles.<role> routing when there is no tier model', () => {
    mocks.determineModel.mockReturnValue('claude-opus-4-8')

    expect(resolveRoutedSpawnModel({ role: 'review', issueId: 'PAN-2', workspace: '/ws' })).toBe('claude-opus-4-8')
    expect(mocks.resolveSingleWorkTierSpawnParams).not.toHaveBeenCalled()
    expect(mocks.determineModel).toHaveBeenCalledWith({ model: undefined, role: 'review', spawnKey: 'review:PAN-2' })
  })

  it('throws a "no default model configured" error when routing cannot resolve', () => {
    mocks.determineModel.mockImplementation(() => {
      throw new Error('config.yaml: roles.work.model references workhorse:mid but workhorses.mid is not defined')
    })

    expect(() => resolveRoutedSpawnModel({ role: 'work', issueId: 'PAN-3' }))
      .toThrow(/No default model configured for role "work" \(PAN-3\).*workhorses\.mid is not defined.*roles\.work\.model/)
  })
})
