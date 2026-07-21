import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeOverdeckDatabaseSync, getOverdeckDatabaseSync } from '../../../lib/overdeck/infra.js';
import { listAllAgentsSync } from '../../../lib/overdeck/agents.js';
import { registerDbCommands } from '../db.js';

describe('pan admin db gc-agents', () => {
  const originalOverdeckHome = process.env.OVERDECK_HOME;
  let testHome: string;
  let logs: string[];

  beforeEach(() => {
    testHome = join(tmpdir(), `gc-agents-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    process.env.OVERDECK_HOME = testHome;
    closeOverdeckDatabaseSync();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeOverdeckDatabaseSync();
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  async function runGcAgents(args: string[] = []): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerDbCommands(program);
    await program.parseAsync(['node', 'test', 'db', 'gc-agents', ...args]);
  }

  function seedIssue(id: string, stage: string): void {
    getOverdeckDatabaseSync().prepare(`
      INSERT INTO issues (id, stage, updated_at)
      VALUES (?, ?, ?)
    `).run(id, stage, Date.now());
  }

  function seedAgent(
    id: string,
    issueId: string,
    role: string,
    status: string,
    flags: { paused?: boolean; troubled?: boolean } = {},
  ): void {
    mkdirSync(join(testHome, 'agents', id), { recursive: true });
    getOverdeckDatabaseSync().prepare(`
      INSERT INTO agents (id, issue_id, role, status, workspace, harness, model, paused, troubled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      issueId,
      role,
      status,
      `/workspaces/${id}`,
      'claude-code',
      'claude',
      flags.paused ? 1 : 0,
      flags.troubled ? 1 : 0,
      Date.now(),
    );
  }

  function seedFixture(): void {
    seedIssue('PAN-TERM', 'closed');
    seedIssue('PAN-CANCELLED', 'cancelled');
    seedIssue('PAN-OPEN', 'working');
    seedAgent('agent-terminal-1', 'PAN-TERM', 'work', 'stopped');
    seedAgent('agent-terminal-2', 'PAN-CANCELLED', 'work', 'stopped');
    seedAgent('agent-paused-terminal', 'PAN-TERM', 'work', 'stopped', { paused: true });
    seedAgent('agent-troubled-terminal', 'PAN-TERM', 'work', 'stopped', { troubled: true });
    seedAgent('agent-running-terminal', 'PAN-TERM', 'work', 'running');
    seedAgent('agent-open', 'PAN-OPEN', 'work', 'stopped');
    seedAgent('agent-review-terminal', 'PAN-TERM', 'review', 'stopped');
  }

  it('reports candidates without deleting rows or state dirs in dry-run mode', async () => {
    seedFixture();

    await runGcAgents(['--dry-run']);

    // PAN-2543 D10/FR-11: every *stopped* row on a terminal issue prunes,
    // regardless of role or paused/troubled flags (those gate resume, not GC —
    // a terminal issue never resumes). Only live/non-stopped rows and rows on
    // non-terminal issues survive.
    expect(logs.join('\n')).toContain('Would reap 5 agent(s).');
    expect(logs.join('\n')).toContain('agent-terminal-1');
    expect(logs.join('\n')).toContain('agent-terminal-2');
    expect(logs.join('\n')).toContain('agent-paused-terminal');
    expect(logs.join('\n')).toContain('agent-troubled-terminal');
    expect(logs.join('\n')).toContain('agent-review-terminal');
    expect(listAllAgentsSync().map((agent) => agent.id).sort()).toEqual([
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

  it('reaps every stopped row on terminal issues and preserves live/non-terminal rows', async () => {
    seedFixture();

    await runGcAgents();

    expect(logs.join('\n')).toContain('Reaped 5 agent(s).');
    expect(listAllAgentsSync().map((agent) => agent.id).sort()).toEqual([
      'agent-open',
      'agent-running-terminal',
    ]);
    expect(existsSync(join(testHome, 'agents', 'agent-terminal-1'))).toBe(false);
    expect(existsSync(join(testHome, 'agents', 'agent-terminal-2'))).toBe(false);
    expect(existsSync(join(testHome, 'agents', 'agent-paused-terminal'))).toBe(false);
    expect(existsSync(join(testHome, 'agents', 'agent-troubled-terminal'))).toBe(false);
    expect(existsSync(join(testHome, 'agents', 'agent-review-terminal'))).toBe(false);
    expect(existsSync(join(testHome, 'agents', 'agent-running-terminal'))).toBe(true);
    expect(existsSync(join(testHome, 'agents', 'agent-open'))).toBe(true);
  });
});
