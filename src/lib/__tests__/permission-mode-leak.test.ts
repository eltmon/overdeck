import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAgentRuntimeBaseCommand } from '../agents.js'

// CRITICAL trust property: when the user has set permissionMode=auto in Settings
// (or via --no-yolo / PAN_YOLO=false), NO spawn path may emit
// --dangerously-skip-permissions. Enterprise users depend on Auto being honored
// without exception; a silent escalation to bypass is a P0 trust violation.
//
// This file exists to prevent regression of the bug observed in v0.8.20 where
// claudish-routed conversations (e.g. kimi-k2.6) launched with
//   "claudish -i --model kc@kimi-k2.6 --dangerously-skip-permissions --permission-mode bypassPermissions"
// even when the dashboard Permissions setting was Auto. Root cause: the claudish
// branch in getAgentRuntimeBaseCommand hardcoded 'bypass' instead of resolving
// the user's setting. The fix replaces the hardcoded literal with
// resolvePermissionMode() and throws when claudish is paired with auto (claudish
// cannot proxy --permission-mode auto, so silent fallback to bypass is unsafe).

const ORIGINAL_YOLO = process.env.PAN_YOLO

describe('Permission-mode leak prevention — DSP must NEVER appear under Auto', () => {
  beforeEach(() => { process.env.PAN_YOLO = 'false' })
  afterEach(() => {
    if (ORIGINAL_YOLO === undefined) delete process.env.PAN_YOLO
    else process.env.PAN_YOLO = ORIGINAL_YOLO
  })

  // ── Anthropic direct path ──────────────────────────────────────────────────

  it('Anthropic + Auto + bare invocation: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6')
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
    expect(cmd).toMatch(/--permission-mode auto/)
  })

  it('Anthropic + Auto + --agent: no DSP, no permission flag (frontmatter handles)', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'work')
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  // ── Claudish path (Kimi, MiniMax, GLM, OpenRouter, Mimo, …) ────────────────

  it('Claudish-routed model + Auto: REFUSED (no silent fallback to bypass)', async () => {
    await expect(getAgentRuntimeBaseCommand('kimi-k2.6')).rejects.toThrow(
      /claudish.*does not support permissionMode=auto/i,
    )
  })

  it('Claudish + Auto refusal mentions remediation paths', async () => {
    await expect(getAgentRuntimeBaseCommand('kimi-k2.6')).rejects.toThrow(/Bypass/)
    await expect(getAgentRuntimeBaseCommand('kimi-k2.6')).rejects.toThrow(/Claude or GPT/)
    await expect(getAgentRuntimeBaseCommand('kimi-k2.6')).rejects.toThrow(/PAN-1015/)
  })

  it('Claudish refusal applies to ALL claudish-routed providers, not just Kimi', async () => {
    // Sample one real model from each claudish-routed provider in providers.ts.
    const claudishModels = [
      'kimi-k2.6',
      'minimax-m2.7',
      'glm-4.7',
      'gemini-3-flash',
      'mimo-v2.5',
    ]
    for (const m of claudishModels) {
      await expect(
        getAgentRuntimeBaseCommand(m),
        `model ${m} must refuse claudish+auto`,
      ).rejects.toThrow(/claudish.*does not support permissionMode=auto/i)
    }
  })

  // ── PAN_YOLO escape hatch (explicit opt-in to bypass) ──────────────────────

  it('Claudish + PAN_YOLO=true (bypass): DSP present, no error', async () => {
    process.env.PAN_YOLO = 'true'
    const cmd = await getAgentRuntimeBaseCommand('kimi-k2.6')
    expect(cmd).toMatch(/^claudish -i /)
    expect(cmd).toMatch(/--dangerously-skip-permissions/)
    expect(cmd).toMatch(/bypassPermissions/)
  })

  it('Anthropic + PAN_YOLO=true + --agent: DSP present alongside --agent', async () => {
    process.env.PAN_YOLO = 'true'
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'work')
    expect(cmd).toMatch(/--dangerously-skip-permissions/)
    expect(cmd).toMatch(/--agent pan-work-agent/)
  })

  // ── Sanity: command never emits DSP under Auto across the surface ─────────

  it('Auto mode produces zero DSP across every Anthropic spawn shape', async () => {
    const shapes = await Promise.all([
      getAgentRuntimeBaseCommand('claude-sonnet-4-6'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'work'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'planning'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'review'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'planning-pan-1', 'planning'),
    ])
    for (const cmd of shapes) {
      expect(cmd, `cmd should not contain DSP under Auto: ${cmd}`).not.toMatch(/--dangerously-skip-permissions/)
      expect(cmd, `cmd should not contain bypassPermissions under Auto: ${cmd}`).not.toMatch(/bypassPermissions/)
    }
  })
})
