/**
 * PAN-5353: sendNowToAgent refuses in order — unknown agent, unsupported
 * harness, not running, remote, a pending permission prompt, an ensure-main
 * refusal — and only presses the send-now chord once every check passes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../agent-state-read.js';
import { sendNowToAgent, type AgentSendNowDeps } from '../send-now.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../__fixtures__/claude-code-2.1.280/${name}`, import.meta.url), 'utf8');
}

function makeState(partial: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    workspace: '/tmp/workspace',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-5-5',
    status: 'running',
    startedAt: new Date().toISOString(),
    ...partial,
  };
}

function makeDeps(overrides: Partial<AgentSendNowDeps> = {}): AgentSendNowDeps {
  return {
    getAgentState: vi.fn(() => makeState()),
    getRuntimeState: vi.fn(() => null),
    isRemote: vi.fn(async () => false),
    readPane: vi.fn(async () => '❯ '),
    ensureMain: vi.fn(async () => ({ ok: true as const, check: 'no-selector' as const })),
    press: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('sendNowToAgent', () => {
  it('refuses an unknown agent', async () => {
    const deps = makeDeps({ getAgentState: vi.fn(() => null) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toEqual({ ok: false, status: 404, code: 'not-found', error: 'Agent not found: agent-pan-1' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses a non-Claude-Code harness', async () => {
    const deps = makeDeps({ getAgentState: vi.fn(() => makeState({ harness: 'codex' })) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toMatchObject({ ok: false, status: 422, code: 'steer-unsupported' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses a paused agent', async () => {
    const deps = makeDeps({ getAgentState: vi.fn(() => makeState({ paused: true })) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toMatchObject({ ok: false, status: 409, code: 'not-running', error: 'agent-pan-1 is paused, so it has no running turn to interrupt' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses a suspended agent', async () => {
    const deps = makeDeps({ getRuntimeState: vi.fn(() => ({ state: 'suspended' })) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toMatchObject({ ok: false, status: 409, code: 'not-running', error: 'agent-pan-1 is suspended, so it has no running turn to interrupt' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses a stopped agent', async () => {
    const deps = makeDeps({ getAgentState: vi.fn(() => makeState({ status: 'stopped' })) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toMatchObject({ ok: false, status: 409, code: 'not-running', error: 'agent-pan-1 is stopped, so it has no running turn to interrupt' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses a remote agent', async () => {
    const deps = makeDeps({ isRemote: vi.fn(async () => true) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toMatchObject({ ok: false, status: 422, code: 'steer-unsupported', error: 'Send now is not supported for remote agents (agent-pan-1)' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses while a permission prompt sits on the pane, without calling ensure-main', async () => {
    const deps = makeDeps({ readPane: vi.fn(async () => fixture('permission-bash.txt')) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toMatchObject({ ok: false, status: 409, code: 'permission-pending' });
    expect(deps.ensureMain).not.toHaveBeenCalled();
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses when ensure-main cannot reach the main agent', async () => {
    const deps = makeDeps({
      ensureMain: vi.fn(async () => ({ ok: false as const, reason: 'stuck on the selector', inputTarget: 'subagent' as never })),
    });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toEqual({ ok: false, status: 409, code: 'input-target-not-main', error: 'stuck on the selector' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('reports a press failure but still called press once', async () => {
    const deps = makeDeps({ press: vi.fn(async () => { throw new Error('herdr call failed'); }) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toMatchObject({ ok: false, status: 502, code: 'press-failed', error: "Could not press send-now in agent-pan-1's pane: herdr call failed" });
    expect(deps.press).toHaveBeenCalledTimes(1);
  });

  it('still calls ensure-main and presses when the pane is unreadable', async () => {
    const deps = makeDeps({ readPane: vi.fn(async () => { throw new Error('no such pane'); }) });
    const result = await sendNowToAgent('agent-pan-1', deps);
    expect(result).toEqual({ ok: true });
    expect(deps.ensureMain).toHaveBeenCalledTimes(1);
    expect(deps.press).toHaveBeenCalledTimes(1);
  });

  it('presses once with the normalized id on the happy path', async () => {
    const deps = makeDeps();
    const result = await sendNowToAgent('PAN-1', deps);
    expect(result).toEqual({ ok: true });
    expect(deps.press).toHaveBeenCalledTimes(1);
    expect(deps.press).toHaveBeenCalledWith('agent-pan-1');
  });
});
