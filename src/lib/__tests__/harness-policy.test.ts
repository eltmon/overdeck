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

const HARNESSES: Array<RuntimeName | 'pi'> = ['claude-code', 'pi', 'ohmypi', 'codex', 'acp', 'kimi-code']
const HARNESSES_WITHOUT_ACP = HARNESSES.filter((harness) => harness !== 'acp' && harness !== 'kimi-code')
const PROVIDERS = Object.keys(MODEL_BY_PROVIDER) as Array<keyof typeof MODEL_BY_PROVIDER>
const AUTH_MODES: Array<AuthMode | undefined> = ['api-key', 'subscription', undefined]

describe('canUseHarness', () => {
  it('AC(PAN-1989): blocks ohmypi + Anthropic + subscription with a non-empty human-readable reason', () => {
    const decision = canUseHarnessSync('ohmypi', MODEL_BY_PROVIDER.anthropic, 'subscription')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBeTruthy()
    expect(decision.reason!.length).toBeGreaterThan(20)
    expect(decision.reason!.toLowerCase()).toContain('ohmypi')
    expect(decision.reason!.toLowerCase()).toContain('anthropic')
  })

  it('AC(PAN-2528): ohmypi + Anthropic + subscription reason names the Claude Code subscription Terms of Service', () => {
    const decision = canUseHarnessSync('ohmypi', MODEL_BY_PROVIDER.anthropic, 'subscription')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('Terms of Service')
  })

  it('AC(PAN-2528): the ohmypi subscription-block reason still tells the user how to proceed', () => {
    const decision = canUseHarnessSync('ohmypi', MODEL_BY_PROVIDER.anthropic, 'subscription')
    const reason = decision.reason!.toLowerCase()
    expect(reason).toContain('api-key')
    expect(reason).toContain('non-anthropic')
  })

  it('allows ohmypi + Anthropic + api-key', () => {
    expect(canUseHarnessSync('ohmypi', MODEL_BY_PROVIDER.anthropic, 'api-key')).toEqual({ allowed: true })
  })

  it('allows ohmypi + Anthropic + undefined authMode (no subscription engaged)', () => {
    expect(canUseHarnessSync('ohmypi', MODEL_BY_PROVIDER.anthropic, undefined)).toEqual({ allowed: true })
  })

  it.each(['openai', 'google', 'minimax', 'openrouter'] as const)(
    'allows ohmypi + non-Anthropic (%s) on every authMode',
    provider => {
      const model = MODEL_BY_PROVIDER[provider]
      for (const authMode of AUTH_MODES) {
        expect(canUseHarnessSync('ohmypi', model, authMode)).toEqual({ allowed: true })
      }
    },
  )

  it.each(PROVIDERS)('allows claude-code + %s on every authMode', provider => {
    const model = MODEL_BY_PROVIDER[provider]
    for (const authMode of AUTH_MODES) {
      expect(canUseHarnessSync('claude-code', model, authMode)).toEqual({ allowed: true })
    }
  })

  it.each(PROVIDERS)('allows codex + %s on every authMode', provider => {
    const model = MODEL_BY_PROVIDER[provider]
    for (const authMode of AUTH_MODES) {
      expect(canUseHarnessSync('codex', model, authMode)).toEqual({ allowed: true })
    }
  })

  it.each(PROVIDERS)('allows pi (legacy) + %s on every authMode (normalizer converts pi→ohmypi before policy check)', provider => {
    const model = MODEL_BY_PROVIDER[provider]
    for (const authMode of AUTH_MODES) {
      expect(canUseHarnessSync('pi', model, authMode)).toEqual({ allowed: true })
    }
  })

  it('explicitly allows canUseHarnessSync("codex", ...) — no ToS block', () => {
    expect(canUseHarnessSync('codex', MODEL_BY_PROVIDER.anthropic, 'subscription')).toEqual({ allowed: true })
    expect(canUseHarnessSync('codex', MODEL_BY_PROVIDER.openai, 'api-key')).toEqual({ allowed: true })
    expect(canUseHarnessSync('codex', MODEL_BY_PROVIDER.anthropic, undefined)).toEqual({ allowed: true })
  })

  it('allows ACP + Kimi under API-key and subscription-backed OAuth auth', () => {
    expect(canUseHarnessSync('acp', 'kimi-k2.7-code', 'api-key')).toEqual({ allowed: true })
    expect(canUseHarnessSync('acp', 'kimi-k2.7-code', 'subscription')).toEqual({ allowed: true })
  })

  it.each(PROVIDERS)('blocks ACP + unsupported %s provider', (provider) => {
    const decision = canUseHarnessSync('acp', MODEL_BY_PROVIDER[provider], 'subscription')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('Kimi')
  })

  it('allows Kimi Code + Kimi under API-key and subscription-backed OAuth auth', () => {
    expect(canUseHarnessSync('kimi-code', 'kimi-k2.7-code', 'api-key')).toEqual({ allowed: true })
    expect(canUseHarnessSync('kimi-code', 'kimi-k2.7-code', 'subscription')).toEqual({ allowed: true })
  })

  it.each(PROVIDERS)('blocks Kimi Code + unsupported %s provider', (provider) => {
    const decision = canUseHarnessSync('kimi-code', MODEL_BY_PROVIDER[provider], 'subscription')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('Kimi')
  })

  it('never coerces the harness for a blocked kimi-code + non-Kimi model combination', () => {
    const decision = canUseHarnessSync('kimi-code', MODEL_BY_PROVIDER.openai, 'api-key')
    expect(decision).toEqual({
      allowed: false,
      reason: 'The Kimi Code harness runs Kimi (Moonshot) models only. Pick a Kimi model, or use the model\'s supported harness.',
    })
  })

  it('blocks gpt-5.5 + api-key on every harness (subscription-only model)', () => {
    for (const harness of HARNESSES) {
      const decision = canUseHarnessSync(harness, 'gpt-5.5', 'api-key')
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBeTruthy()
      expect(decision.reason!.toLowerCase()).toContain('subscription')
    }
  })

  it('allows gpt-5.5 + subscription on every supported non-ACP harness', () => {
    for (const harness of HARNESSES_WITHOUT_ACP) {
      expect(canUseHarnessSync(harness, 'gpt-5.5', 'subscription')).toEqual({ allowed: true })
    }
  })

  it('allows gpt-5.5 + undefined authMode on every supported non-ACP harness', () => {
    for (const harness of HARNESSES_WITHOUT_ACP) {
      expect(canUseHarnessSync(harness, 'gpt-5.5', undefined)).toEqual({ allowed: true })
    }
  })

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'blocks %s + api-key on every harness (subscription-only model)',
    (model) => {
      for (const harness of HARNESSES) {
        const decision = canUseHarnessSync(harness, model, 'api-key')
        expect(decision.allowed).toBe(false)
        expect(decision.reason).toBeTruthy()
        expect(decision.reason!.toLowerCase()).toContain('subscription')
      }
    },
  )

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'allows %s + subscription on every supported non-ACP harness',
    (model) => {
      for (const harness of HARNESSES_WITHOUT_ACP) {
        expect(canUseHarnessSync(harness, model, 'subscription')).toEqual({ allowed: true })
      }
    },
  )

  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const)(
    'allows %s + undefined authMode on every supported non-ACP harness',
    (model) => {
      for (const harness of HARNESSES_WITHOUT_ACP) {
        expect(canUseHarnessSync(harness, model, undefined)).toEqual({ allowed: true })
      }
    },
  )

  it('covers the full 6 x 5 x 3 matrix including Kimi-only ACP and Kimi Code policy', () => {
    const cells: Array<{ harness: RuntimeName | 'pi'; provider: string; authMode: AuthMode | undefined; allowed: boolean }> = []
    for (const harness of HARNESSES) {
      for (const provider of PROVIDERS) {
        for (const authMode of AUTH_MODES) {
          const isBlockedCell =
            (harness === 'ohmypi' && provider === 'anthropic' && authMode === 'subscription')
            || harness === 'acp'
            || harness === 'kimi-code'
          cells.push({ harness, provider, authMode, allowed: !isBlockedCell })
        }
      }
    }
    expect(cells).toHaveLength(6 * 5 * 3)
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
