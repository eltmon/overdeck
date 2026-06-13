import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
        // test_agent intentionally absent — falls back to default.
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
        // test_agent intentionally absent — falls back to default.
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

import { ModelRouter, getSpecialistHarness, resetGlobalRouter } from '../router.js'

describe('ModelRouter.getSpecialistHarness (PAN-636)', () => {
  beforeEach(() => {
    rolesConfig.roles = {}
    resetGlobalRouter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies the legacy specialist_harnesses alias when roles.<role>.harness is absent', () => {
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

  it('prefers roles.<role>.harness over the legacy specialist_harnesses alias', () => {
    rolesConfig.roles = {
      review: { model: 'workhorse:expensive', harness: 'codex' },
      ship: { model: 'workhorse:mid', harness: 'pi' },
    }
    const router = new ModelRouter()
    expect(router.getSpecialistHarness('review-agent')).toBe('codex')
    expect(router.getSpecialistHarness('merge-agent')).toBe('pi')
  })

  it('logs the legacy alias deprecation warning once when the alias applies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = new ModelRouter()

    expect(router.getSpecialistHarness('review-agent')).toBe('pi')
    expect(router.getSpecialistHarness('review-agent')).toBe('pi')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'model_selection.specialist_harnesses.review_agent is deprecated; use roles.review.harness instead.'
    )
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
    expect(getSpecialistHarness('review-agent')).toBe('pi')
  })
})
