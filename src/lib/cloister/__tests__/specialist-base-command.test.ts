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

vi.mock('../../agents.js', () => ({
  getAgentRuntimeBaseCommand: vi.fn(async (model: string, harness: string) => {
    if (harness === 'pi') return `pi --mode rpc --model ${model}`
    return `claude --dangerously-skip-permissions --permission-mode bypassPermissions --model ${model}`
  }),
  getProviderAuthMode: vi.fn(async () => 'subscription'),
  // Required for router.ts side-effects on import — not used in this test.
  getProviderExportsForModel: vi.fn(),
}))

import { resolveSpecialistBaseCommand, resetGlobalRouter } from '../router.js'

describe('resolveSpecialistBaseCommand (PAN-636)', () => {
  it('claude-code role -> claude command via getAgentRuntimeBaseCommand(model, claude-code)', async () => {
    resetGlobalRouter()
    const cmd = await resolveSpecialistBaseCommand('merge-agent', 'gpt-5.5-mini')
    expect(cmd).toBe('claude --dangerously-skip-permissions --permission-mode bypassPermissions --model gpt-5.5-mini')
  })

  it('pi role + non-Anthropic model -> pi command (ToS gate allows)', async () => {
    resetGlobalRouter()
    const cmd = await resolveSpecialistBaseCommand('review-agent', 'gpt-5.5-mini')
    expect(cmd).toBe('pi --mode rpc --model gpt-5.5-mini')
  })

  it('pi role + Anthropic model + subscription auth -> ToS gate falls back to claude-code with warning', async () => {
    resetGlobalRouter()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const cmd = await resolveSpecialistBaseCommand('review-agent', 'claude-sonnet-4-6')
      expect(cmd).toBe('claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6')
      expect(warnSpy).toHaveBeenCalled()
      expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/blocked/)
      expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/Falling back to claude-code/)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('explicit harness override beats config', async () => {
    resetGlobalRouter()
    // merge-agent is configured as claude-code; explicitly pass pi.
    const cmd = await resolveSpecialistBaseCommand('merge-agent', 'gpt-5.5-mini', 'pi')
    expect(cmd).toBe('pi --mode rpc --model gpt-5.5-mini')
  })
})
