import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAgentRuntimeBaseCommand } from '../agents.js'

// CRITICAL trust property: when the user has set permissionMode=auto in Settings
// (or via --no-yolo / PAN_YOLO=false), NO spawn path may emit
// --dangerously-skip-permissions. Enterprise users depend on Auto being honored
// without exception; a silent escalation to bypass is a P0 trust violation.
//
// This file exists to prevent regression of the bug observed in v0.8.20 where
// a provider-specific launch branch emitted
//   "claude --model qwen/qwen3.6-plus:free --dangerously-skip-permissions --permission-mode bypassPermissions"
// even when the dashboard Permissions setting was Auto. Root cause: the branch
// hardcoded 'bypass' instead of resolving the user's setting. The direct-routing
// command builder must honor resolvePermissionMode() for every provider.

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

  it('Anthropic + Auto + work role: uses roles/work.md and no DSP or permission flag', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'work')
    expect(cmd).toMatch(/--agent roles\/work\.md/)
    expect(cmd).not.toMatch(/--agent pan-work-agent/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('Kimi direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('kimi-k2.6')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model kimi-k2\.6/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('Z.AI direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('glm-4.7')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model glm-4\.7/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('MiniMax direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('minimax-m2.7')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model minimax-m2\.7/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('Mimo direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('mimo-v2.5')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model mimo-v2\.5/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('OpenRouter direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('qwen/qwen3.6-plus:free')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model qwen\/qwen3\.6-plus:free/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  // ── PAN_YOLO escape hatch (explicit opt-in to bypass) ──────────────────────

  it('Kimi direct + PAN_YOLO=true (bypass): DSP present on direct Claude Code command', async () => {
    process.env.PAN_YOLO = 'true'
    const cmd = await getAgentRuntimeBaseCommand('kimi-k2.6')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model kimi-k2\.6/)
    expect(cmd).toMatch(/--dangerously-skip-permissions/)
    expect(cmd).toMatch(/bypassPermissions/)
  })

  it('Anthropic + PAN_YOLO=true + --agent: DSP present alongside --agent', async () => {
    process.env.PAN_YOLO = 'true'
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'work')
    expect(cmd).toMatch(/--dangerously-skip-permissions/)
    expect(cmd).toMatch(/--agent roles\/work\.md/)
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
