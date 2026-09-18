import { describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../agents/agent-state.js';
import { parsePinnedAgentLaunch } from '../agents/pinned-launch.js';

describe('parsePinnedAgentLaunch', () => {
  it('recovers a Claude Code model and pinned session', () => {
    expect(parsePinnedAgentLaunch(
      "exec node '/opt/overdeck/dist/pty-supervisor.js' claude --effort high --model 'gpt-5.6-sol' --session-id 'session-1'",
      'session-1\n',
    )).toEqual({
      sessionId: 'session-1',
      model: 'gpt-5.6-sol',
      harness: 'claude-code',
    });
  });

  it('recovers Pi and Codex launcher models', () => {
    expect(parsePinnedAgentLaunch(
      "exec omp --mode rpc --model 'claude-sonnet-5' --session-dir '/tmp/session'",
      'pi-session',
    )).toEqual({
      sessionId: 'pi-session',
      model: 'claude-sonnet-5',
      harness: 'ohmypi',
    });
    expect(parsePinnedAgentLaunch(
      "exec node '/opt/overdeck/dist/codex-app-server-host.js' --model 'gpt-5.6-sol'",
      'codex-thread',
    )).toEqual({
      sessionId: 'codex-thread',
      model: 'gpt-5.6-sol',
      harness: 'codex',
    });
  });

  it('rejects launchers without both a real model and session id', () => {
    expect(parsePinnedAgentLaunch('exec claude --model pending-example-spawn', '')).toBeNull();
    expect(parsePinnedAgentLaunch('exec sleep 60', 'session-1')).toBeNull();
  });
});
