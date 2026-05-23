import { describe, expect, it } from 'vitest'
import { canUseHarnessSync } from '../harness-policy.js'
import type { RuntimeName } from '../runtimes/types.js'
import type { AuthMode } from '../subscription-types.js'

// One representative model id per provider that getProviderForModel() resolves
// today. Keeping these explicit guards us against silent provider re-routing.
// gpt-5.4 is used (not gpt-5.5) because gpt-5.5 has its own auth-mode rule
// (subscription-only) that the matrix below does not cover; gpt-5.5 is
// validated by its own dedicated test.
const MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
  google: 'gemini-3-pro-preview',
  minimax: 'minimax-m2.7',
  openrouter: 'qwen/qwen3.6-plus:free',
} as const

const HARNESSES: RuntimeName[] = ['claude-code', 'pi']
const PROVIDERS = Object.keys(MODEL_BY_PROVIDER) as Array<keyof typeof MODEL_BY_PROVIDER>
const AUTH_MODES: Array<AuthMode | undefined> = ['api-key', 'subscription', undefined]

describe('canUseHarness', () => {
  it('blocks Pi + Anthropic + subscription with a non-empty human-readable reason', () => {
    const decision = canUseHarnessSync('pi', MODEL_BY_PROVIDER.anthropic, 'subscription')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBeTruthy()
    expect(decision.reason!.length).toBeGreaterThan(20)
    expect(decision.reason!.toLowerCase()).toContain('pi')
    expect(decision.reason!.toLowerCase()).toContain('anthropic')
  })

  it('allows Pi + Anthropic + api-key', () => {
    expect(canUseHarnessSync('pi', MODEL_BY_PROVIDER.anthropic, 'api-key')).toEqual({ allowed: true })
  })

  it('allows Pi + Anthropic + undefined authMode (no subscription engaged)', () => {
    expect(canUseHarnessSync('pi', MODEL_BY_PROVIDER.anthropic, undefined)).toEqual({ allowed: true })
  })

  it.each(['openai', 'google', 'minimax', 'openrouter'] as const)(
    'allows Pi + non-Anthropic (%s) on every authMode',
    provider => {
      const model = MODEL_BY_PROVIDER[provider]
      for (const authMode of AUTH_MODES) {
        expect(canUseHarnessSync('pi', model, authMode)).toEqual({ allowed: true })
      }
    },
  )

  it.each(PROVIDERS)('allows claude-code + %s on every authMode', provider => {
    const model = MODEL_BY_PROVIDER[provider]
    for (const authMode of AUTH_MODES) {
      expect(canUseHarnessSync('claude-code', model, authMode)).toEqual({ allowed: true })
    }
  })

  it('blocks gpt-5.5 + api-key on every harness (subscription-only model)', () => {
    for (const harness of HARNESSES) {
      const decision = canUseHarnessSync(harness, 'gpt-5.5', 'api-key')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBeTruthy()
      expect(decision.reason!.toLowerCase()).toContain('subscription')
    }
  })

  it('allows gpt-5.5 + subscription on every harness', () => {
    for (const harness of HARNESSES) {
      expect(canUseHarnessSync(harness, 'gpt-5.5', 'subscription')).toEqual({ allowed: true })
    }
  })

  it('allows gpt-5.5 + undefined authMode (no auth context engaged)', () => {
    for (const harness of HARNESSES) {
      expect(canUseHarnessSync(harness, 'gpt-5.5', undefined)).toEqual({ allowed: true })
    }
  })

  it('covers the full 2 x 5 x 3 matrix with explicit per-cell expectations', () => {
    const cells: Array<{ harness: RuntimeName; provider: string; authMode: AuthMode | undefined; allowed: boolean }> = []
    for (const harness of HARNESSES) {
      for (const provider of PROVIDERS) {
        for (const authMode of AUTH_MODES) {
          const isBlockedCell =
            harness === 'pi' && provider === 'anthropic' && authMode === 'subscription'
          cells.push({ harness, provider, authMode, allowed: !isBlockedCell })
        }
      }
    }
    expect(cells).toHaveLength(2 * 5 * 3)
    for (const cell of cells) {
      const model = MODEL_BY_PROVIDER[cell.provider as keyof typeof MODEL_BY_PROVIDER]
      const decision = canUseHarnessSync(cell.harness, model, cell.authMode)
      expect(
        decision.allowed,
        `${cell.harness} / ${cell.provider} / ${cell.authMode ?? 'unset'} should be ${cell.allowed ? 'allowed' : 'blocked'}`,
      ).toBe(cell.allowed)
      if (!cell.allowed) {
        expect(decision.reason, 'blocked cell must carry a reason').toBeTruthy()
      }
    }
  })
})
