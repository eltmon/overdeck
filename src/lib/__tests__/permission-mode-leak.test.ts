import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAgentRuntimeBaseCommand, getRoleRuntimeBaseCommand } from '../agents.js'

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

  // PAN-2087: Claude Code 2.1.195 dropped `--agent <file>` support, so role
  // definition FILES (roles/<role>.md) are injected as an appended system prompt
  // instead. Registered agent NAMES (pan-*-agent) still launch via `--agent`.

  it('Anthropic + Auto + work role: injects roles/work.md as system prompt, preserves model override, no DSP', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'roles/work.md')
    expect(cmd).not.toMatch(/--agent /)                                   // no --agent for role FILES
    expect(cmd).toMatch(/--append-system-prompt-file '[^']*role-prompts\/work\.md'/)
    expect(cmd).toMatch(/--effort high/)                                  // from roles/work.md frontmatter
    expect(cmd).toMatch(/--model 'claude-sonnet-4-6'/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('Anthropic + Auto + plan role: injects roles/plan.md as system prompt, no DSP', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-opus-4-7', 'planning-pan-1', 'roles/plan.md')
    expect(cmd).not.toMatch(/--agent /)
    expect(cmd).toMatch(/--append-system-prompt-file '[^']*role-prompts\/plan\.md'/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('registered agent NAME still launches via --agent <name> (not a file → not injected)', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'pan-review-agent')
    expect(cmd).toMatch(/--agent pan-review-agent/)
    expect(cmd).not.toMatch(/--append-system-prompt-file/)
    expect(cmd).toMatch(/--model 'claude-sonnet-4-6'/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
  })

  it('role runtime command injects the role system prompt when the role definition file exists', async () => {
    const cmd = await getRoleRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'work')
    expect(cmd).not.toMatch(/--agent /)
    expect(cmd).toMatch(/--append-system-prompt-file '[^']*role-prompts\/work\.md'/)
    expect(cmd).toMatch(/--model 'claude-sonnet-4-6'/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
  })

  it('role runtime command falls back to global permission flags when the role definition file is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const cmd = await getRoleRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1-ship', 'ship')

      expect(cmd).not.toMatch(/--agent roles\/ship\.md/)
      expect(cmd).toMatch(/--permission-mode auto/)
      expect(cmd).toMatch(/--model 'claude-sonnet-4-6'/)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('roles/ship.md'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('Kimi direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('kimi-k2.6')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model 'kimi-k2\.6'/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('Z.AI direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('glm-4.7')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model 'glm-4\.7'/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('MiniMax direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('minimax-m2.7')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model 'minimax-m2\.7'/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('Mimo direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('mimo-v2.5')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model 'mimo-v2\.5'/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('OpenRouter direct + Auto: no DSP, --permission-mode auto', async () => {
    const cmd = await getAgentRuntimeBaseCommand('qwen/qwen3.6-plus:free')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model 'qwen\/qwen3\.6-plus:free'/)
    expect(cmd).toMatch(/--permission-mode auto/)
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  // ── PAN_YOLO escape hatch (explicit opt-in to bypass mode, without DSP) ─────

  it('Kimi direct + PAN_YOLO=true (bypass): bypassPermissions present, never DSP', async () => {
    process.env.PAN_YOLO = 'true'
    const cmd = await getAgentRuntimeBaseCommand('kimi-k2.6')
    expect(cmd).toMatch(/^claude /)
    expect(cmd).toMatch(/--model 'kimi-k2\.6'/)
    // DSP was removed (2026-05-30); bypass is expressed via --permission-mode only.
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).toMatch(/bypassPermissions/)
  })

  it('Anthropic + PAN_YOLO=true + work role: injects role system prompt, bypass via --permission-mode, never DSP', async () => {
    process.env.PAN_YOLO = 'true'
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'roles/work.md')
    // PAN-2087: role FILES are injected, not passed to --agent. Bypass is expressed
    // via --permission-mode bypassPermissions (DSP was removed 2026-05-30), never DSP.
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/--agent /)
    expect(cmd).toMatch(/--append-system-prompt-file '[^']*role-prompts\/work\.md'/)
    expect(cmd).toMatch(/bypassPermissions/)
  })

  // ── Sanity: command never emits DSP under Auto across the surface ─────────

  it('Auto mode produces zero DSP across every Anthropic spawn shape', async () => {
    const shapes = await Promise.all([
      getAgentRuntimeBaseCommand('claude-sonnet-4-6'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'roles/work.md'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'roles/plan.md'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'agent-pan-1', 'pan-review-agent'),
      getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'planning-pan-1', 'roles/plan.md'),
    ])
    for (const cmd of shapes) {
      expect(cmd, `cmd should not contain DSP under Auto: ${cmd}`).not.toMatch(/--dangerously-skip-permissions/)
      expect(cmd, `cmd should not contain bypassPermissions under Auto: ${cmd}`).not.toMatch(/bypassPermissions/)
    }
  })
})
