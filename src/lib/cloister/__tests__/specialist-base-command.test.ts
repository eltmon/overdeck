import { describe, expect, it, vi } from 'vitest'

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
}))

import { getSpecialistHarness, resetGlobalRouter } from '../router.js'

describe('specialist harness routing', () => {
  it('reads configured harnesses from the router', () => {
    resetGlobalRouter()
    expect(getSpecialistHarness('review-agent')).toBe('pi')
    expect(getSpecialistHarness('merge-agent')).toBe('claude-code')
  })

  it('defaults unknown specialists to claude-code', () => {
    resetGlobalRouter()
    expect(getSpecialistHarness('unknown-agent')).toBe('claude-code')
  })
})
