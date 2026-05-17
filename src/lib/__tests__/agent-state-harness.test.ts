import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getAgentRuntimeBaseCommand } from '../agents.js'

// AC3: harness='claude-code' (and the no-harness default) MUST produce
// identical output to the pre-PAN-636 implementation. The pre-PAN-636
// behavior was a single-arg getAgentRuntimeBaseCommand(model) that returned
// the same strings produced today by the harness='claude-code' branch.
//
// AC4: harness='pi' produces a `pi --mode rpc ...` command.

// PAN-982 widened the signature to (model, agentName?, agentType?, harness?).
// The `harness` slot is now the 4th positional. We pass undefined for the
// PAN-982 args (no agent definition / no --name) so the legacy claude-code
// path is exercised — that is the surface PAN-636 must keep bit-for-bit.

describe('getAgentRuntimeBaseCommand harness routing (PAN-636)', () => {
  // Legacy assertions below predate the auto-mode default; pin bypass locally.
  const ORIGINAL_YOLO = process.env.PAN_YOLO
  beforeEach(() => { process.env.PAN_YOLO = 'true' })
  afterEach(() => {
    if (ORIGINAL_YOLO === undefined) delete process.env.PAN_YOLO
    else process.env.PAN_YOLO = ORIGINAL_YOLO
  })

  it('claude-code default and explicit are identical (AC3)', async () => {
    const a = await getAgentRuntimeBaseCommand('claude-sonnet-4-6')
    const b = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', undefined, undefined, 'claude-code')
    expect(a).toBe(b)
  })

  it('claude-code branch builds the legacy "claude --dangerously-skip-permissions ... --model X" command for an Anthropic model', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', undefined, undefined, 'claude-code')
    expect(cmd).toBe("claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'claude-sonnet-4-6'")
  })

  it('pi harness emits a `pi --mode rpc --model <model>` command (AC4)', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', undefined, undefined, 'pi')
    expect(cmd).toBe("pi --mode rpc --model 'claude-sonnet-4-6'")
  })

  it('pi harness emits no claude permission flags', async () => {
    const cmd = await getAgentRuntimeBaseCommand('gpt-5.4-mini', undefined, undefined, 'pi')
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/--permission-mode/)
    expect(cmd).toMatch(/^pi --mode rpc /)
  })
})

// Integration coverage for the new permission-mode plumbing.
// Production default is `auto`; this block exercises that path explicitly,
// then flips PAN_YOLO=true to verify the bypass override still works.
describe('getAgentRuntimeBaseCommand permission-mode integration', () => {
  const ORIGINAL = process.env.PAN_YOLO

  // Pin PAN_YOLO=false so the resolver returns 'auto' regardless of whatever
  // claude.permissionMode the developer has set in ~/.panopticon/config.yaml.
  // Previously this block deleted PAN_YOLO and relied on the resolver falling
  // through to YAML config — flaky: a dev who sets `permissionMode: bypass`
  // locally would see this assertion fail with "expected auto, got bypass" on
  // an otherwise-clean checkout.
  beforeEach(() => { process.env.PAN_YOLO = 'false' })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PAN_YOLO
    else process.env.PAN_YOLO = ORIGINAL
  })

  it('production default emits --permission-mode auto for an Anthropic model', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6')
    expect(cmd).toBe("claude --permission-mode auto --model 'claude-sonnet-4-6'")
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/bypassPermissions/)
  })

  it('PAN_YOLO=true produces the legacy bypass command', async () => {
    process.env.PAN_YOLO = 'true'
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6')
    expect(cmd).toBe("claude --dangerously-skip-permissions --permission-mode bypassPermissions --model 'claude-sonnet-4-6'")
  })
})
