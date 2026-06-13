import { describe, expect, it, vi } from 'vitest'

const rolesConfig = vi.hoisted(() => ({
  roles: {} as Record<string, { model: string; harness?: 'claude-code' | 'pi' | 'codex' }>,
}))

vi.mock('../config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({
    model_selection: {
      default_model: 'sonnet',
      complexity_routing: { trivial: 'haiku', simple: 'haiku', medium: 'sonnet', complex: 'sonnet', expert: 'opus' },
      specialist_models: {},
      specialist_harnesses: {
        review_agent: 'pi',
        merge_agent: 'claude-code',
      },
    },
  })),
  loadCloisterConfigSync: vi.fn(() => ({
    model_selection: {
      default_model: 'sonnet',
      complexity_routing: { trivial: 'haiku', simple: 'haiku', medium: 'sonnet', complex: 'sonnet', expert: 'opus' },
      specialist_models: {},
      specialist_harnesses: {
        review_agent: 'pi',
        merge_agent: 'claude-code',
      },
    },
  })),
}))

vi.mock('../../config-yaml.js', () => ({
  loadConfigSync: vi.fn(() => ({
    config: {
      roles: rolesConfig.roles,
    },
  })),
}))

import { getSpecialistHarness, resetGlobalRouter } from '../router.js'

describe('specialist harness routing', () => {
  it('reads configured harnesses from the router', () => {
    rolesConfig.roles = {}
    resetGlobalRouter()
    expect(getSpecialistHarness('review-agent')).toBe('pi')
    expect(getSpecialistHarness('merge-agent')).toBe('claude-code')
  })

  it('defaults unknown specialists to claude-code', () => {
    rolesConfig.roles = {}
    resetGlobalRouter()
    expect(getSpecialistHarness('unknown-agent')).toBe('claude-code')
  })
})
