import { describe, expect, it } from 'vitest'
import { getAgentRuntimeBaseCommand } from '../agents.js'

// AC3: harness='claude-code' (and the no-harness default) MUST produce
// identical output to the pre-PAN-636 implementation. The pre-PAN-636
// behavior was a single-arg getAgentRuntimeBaseCommand(model) that returned
// the same strings produced today by the harness='claude-code' branch.
//
// AC4: harness='pi' produces a `pi --mode rpc ...` command.

describe('getAgentRuntimeBaseCommand harness routing (PAN-636)', () => {
  it('claude-code default and explicit are identical (AC3)', async () => {
    const a = await getAgentRuntimeBaseCommand('claude-sonnet-4-6')
    const b = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'claude-code')
    expect(a).toBe(b)
  })

  it('claude-code branch builds the legacy "claude --dangerously-skip-permissions ... --model X" command for an Anthropic model', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'claude-code')
    expect(cmd).toBe('claude --dangerously-skip-permissions --permission-mode bypassPermissions --model claude-sonnet-4-6')
  })

  it('pi harness emits a `pi --mode rpc --model <model>` command (AC4)', async () => {
    const cmd = await getAgentRuntimeBaseCommand('claude-sonnet-4-6', 'pi')
    expect(cmd).toBe('pi --mode rpc --model claude-sonnet-4-6')
  })

  it('pi harness emits no claude permission flags', async () => {
    const cmd = await getAgentRuntimeBaseCommand('gpt-5.5-mini', 'pi')
    expect(cmd).not.toMatch(/--dangerously-skip-permissions/)
    expect(cmd).not.toMatch(/--permission-mode/)
    expect(cmd).toMatch(/^pi --mode rpc /)
  })
})
