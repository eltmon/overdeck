import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listAgentStatesSync } from '../../../lib/agents/agent-state.js';
import { registerDbCommands } from '../db.js';

// paths.ts resolves AGENTS_DIR once at module load, so the home has to be
// pointed at a scratch directory before the subject's imports are evaluated.
const testHome = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join: joinPath } = require('node:path') as typeof import('node:path');
  const home = mkdtempSync(joinPath(tmpdir(), 'gc-agents-'));
  process.env.OVERDECK_HOME = home;
  return home;
});

/**
 * PAN-3917: gc-agents used to enumerate overdeck.db rows. The table is dropped,
 * so the candidates are the agent state directories themselves.
 */
describe('pan admin db gc-agents', () => {
  let logs: string[];

  beforeEach(() => {
    rmSync(join(testHome, 'agents'), { recursive: true, force: true });
    mkdirSync(join(testHome, 'agents'), { recursive: true });
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(join(testHome, 'agents'), { recursive: true, force: true });
  });

  async function runGcAgents(args: string[] = []): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerDbCommands(program, {
      pruneTerminalAgents: vi.fn(async (agents, options) => {
        const removable = agents.filter((agent) =>
          agent.status === 'stopped' && agent.issueId !== 'PAN-OPEN');
        if (!options.dryRun) {
          for (const agent of removable) {
            rmSync(join(testHome, 'agents', agent.id), { recursive: true, force: true });
          }
        }
        return { removed: removable.map((agent) => agent.id), preserved: [] };
      }),
    });
    await program.parseAsync(['node', 'test', 'db', 'gc-agents', ...args]);
  }

  function seedAgent(
    id: string,
    issueId: string,
    role: string,
    status: string,
    flags: { paused?: boolean; troubled?: boolean } = {},
  ): void {
    const dir = join(testHome, 'agents', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      id,
      issueId,
      role,
      status,
      workspace: `/workspaces/${id}`,
      harness: 'claude-code',
      model: 'claude',
      startedAt: '2026-01-01T00:00:00.000Z',
      paused: flags.paused ?? false,
      troubled: flags.troubled ?? false,
    }));
  }

  function seedFixture(): void {
    seedAgent('agent-terminal-1', 'PAN-TERM', 'work', 'stopped');
    seedAgent('agent-terminal-2', 'PAN-CANCELLED', 'work', 'stopped');
    seedAgent('agent-paused-terminal', 'PAN-TERM', 'work', 'stopped', { paused: true });
    seedAgent('agent-troubled-terminal', 'PAN-TERM', 'work', 'stopped', { troubled: true });
    seedAgent('agent-running-terminal', 'PAN-TERM', 'work', 'running');
    seedAgent('agent-open', 'PAN-OPEN', 'work', 'stopped');
    seedAgent('agent-review-terminal', 'PAN-TERM', 'review', 'stopped');
  }

  it('reports candidates without deleting state dirs in dry-run mode', async () => {
    seedFixture();

    await runGcAgents(['--dry-run']);

    // PAN-2543 D10/FR-11: every *stopped* agent on a terminal issue prunes,
    // regardless of role or paused/troubled flags (those gate resume, not GC —
    // a terminal issue never resumes). Only live agents and agents on
    // non-terminal issues survive.
    expect(logs.join('\n')).toContain('Would reap 5 agent(s) after live terminality checks.');
    for (const id of [
      'agent-terminal-1', 'agent-terminal-2', 'agent-paused-terminal',
      'agent-troubled-terminal', 'agent-review-terminal',
    ]) {
      expect(logs.join('\n')).toContain(id);
    }
    expect(listAgentStatesSync().map((agent) => agent.id).sort()).toEqual([
      'agent-open',
      'agent-paused-terminal',
      'agent-review-terminal',
      'agent-running-terminal',
      'agent-terminal-1',
      'agent-terminal-2',
      'agent-troubled-terminal',
    ]);
    expect(existsSync(join(testHome, 'agents', 'agent-terminal-1'))).toBe(true);
    expect(existsSync(join(testHome, 'agents', 'agent-terminal-2'))).toBe(true);
  });

  it('reaps every stopped agent on terminal issues and preserves live/non-terminal ones', async () => {
    seedFixture();

    await runGcAgents();

    expect(logs.join('\n')).toContain('Reaped 5 agent(s); preserved 0 agent(s).');
    expect(listAgentStatesSync().map((agent) => agent.id).sort()).toEqual([
      'agent-open',
      'agent-running-terminal',
    ]);
    for (const id of [
      'agent-terminal-1', 'agent-terminal-2', 'agent-paused-terminal',
      'agent-troubled-terminal', 'agent-review-terminal',
    ]) {
      expect(existsSync(join(testHome, 'agents', id))).toBe(false);
    }
    expect(existsSync(join(testHome, 'agents', 'agent-running-terminal'))).toBe(true);
    expect(existsSync(join(testHome, 'agents', 'agent-open'))).toBe(true);
  });
});
