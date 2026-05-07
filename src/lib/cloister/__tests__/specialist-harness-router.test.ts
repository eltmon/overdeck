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
        // test_agent intentionally absent — falls back to default.
      },
    },
  })),
}))

import { ModelRouter, getSpecialistHarness, resetGlobalRouter } from '../router.js'

describe('ModelRouter.getSpecialistHarness (PAN-636)', () => {
  it('returns the configured harness for a known specialist (AC1)', () => {
    const router = new ModelRouter()
    expect(router.getSpecialistHarness('review-agent')).toBe('pi')
    expect(router.getSpecialistHarness('merge-agent')).toBe('claude-code')
  })

  it('normalizes dash-form names to underscore-form (AC1)', () => {
    const router = new ModelRouter()
    // 'merge-agent' must hit merge_agent.
    expect(router.getSpecialistHarness('merge-agent')).toBe('claude-code')
    expect(router.getSpecialistHarness('merge_agent')).toBe('claude-code')
  })

  it('falls back to claude-code for unknown specialist names (AC2)', () => {
    const router = new ModelRouter()
    expect(router.getSpecialistHarness('not-a-specialist')).toBe('claude-code')
  })

  it('falls back to claude-code for specialists without an override', () => {
    const router = new ModelRouter()
    expect(router.getSpecialistHarness('test-agent')).toBe('claude-code')
  })

  it('exposes a global convenience function', () => {
    resetGlobalRouter()
    expect(getSpecialistHarness('review-agent')).toBe('pi')
  })
})
