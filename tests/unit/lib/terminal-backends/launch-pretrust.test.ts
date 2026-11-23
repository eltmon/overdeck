import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { launchAgentPane } from '../../../../src/lib/terminal-backends/launch.js';
import type {
  AgentPaneRef,
  StartAgentSpec,
  TerminalBackend,
  WorkspaceRef,
} from '../../../../src/lib/terminal-backends/types.js';

/**
 * PAN-3905: every spawn path that starts Claude Code goes through
 * launchAgentPane, which marks the pane's cwd trusted in ~/.claude.json before
 * the launch, so the agent never stops at Claude Code's trust dialog.
 *
 * HOME is a temp dir for every test here: the only ~/.claude.json the helper
 * can touch is the one this file seeds.
 */

let tempHome: string;
let claudeJsonPath: string;
let prevHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-3905-launch-home-'));
  prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  claudeJsonPath = join(tempHome, '.claude.json');
  writeFileSync(claudeJsonPath, JSON.stringify({ projects: {} }));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
});

function fakeBackend(onStart: (spec: StartAgentSpec) => void): TerminalBackend {
  const pane: AgentPaneRef = {
    backend: 'herdr',
    workspaceId: 'w1',
    paneId: 'w1:p1',
    terminalId: 'w1:p1',
    agentName: 'agent-pan-1',
  };
  return {
    name: 'herdr',
    workspaceFor: (issueId: string, cwd: string) =>
      Effect.succeed({ backend: 'herdr', workspaceId: 'w1', issueId, cwd } as WorkspaceRef),
    startAgent: (_workspace: WorkspaceRef, spec: StartAgentSpec) => {
      onStart(spec);
      return Effect.succeed(pane);
    },
  } as unknown as TerminalBackend;
}

function readProjects(): Record<string, { hasTrustDialogAccepted?: boolean }> {
  return JSON.parse(readFileSync(claudeJsonPath, 'utf-8')).projects;
}

describe('launchAgentPane pre-trusts the cwd (PAN-3905)', () => {
  const cwd = '/work/proj/workspaces/feature-pan-1';

  it('writes the trust entry for a Claude Code pane before starting it', async () => {
    let trustedAtStart: boolean | undefined;
    await launchAgentPane({
      issueId: 'PAN-1',
      cwd,
      agentId: 'agent-pan-1',
      argv: ['bash', 'launcher.sh'],
      env: {},
      tokens: { issue: 'PAN-1', role: 'work', harness: 'claude-code', model: 'opus' },
    }, fakeBackend(() => { trustedAtStart = readProjects()[cwd]?.hasTrustDialogAccepted; }));

    expect(trustedAtStart).toBe(true);
  });

  it('pre-trusts a conversation pane, which has no issue', async () => {
    const convCwd = '/home/operator/scratch';
    let trustedAtStart: boolean | undefined;
    await launchAgentPane({
      cwd: convCwd,
      agentId: 'conv-20261004-1',
      argv: ['bash', 'launcher.sh'],
      env: {},
      tokens: { role: 'conversation', harness: 'claude-code', model: 'opus' },
    }, fakeBackend(() => { trustedAtStart = readProjects()[convCwd]?.hasTrustDialogAccepted; }));

    expect(trustedAtStart).toBe(true);
  });

  it('leaves ~/.claude.json alone for a harness that is not Claude Code', async () => {
    await launchAgentPane({
      issueId: 'PAN-1',
      cwd,
      agentId: 'agent-pan-1',
      argv: ['bash', 'launcher.sh'],
      env: {},
      tokens: { issue: 'PAN-1', role: 'work', harness: 'codex', model: 'gpt' },
    }, fakeBackend(() => {}));

    expect(readFileSync(claudeJsonPath, 'utf-8')).toBe(JSON.stringify({ projects: {} }));
  });

  it('trusts a real worktree and its repository root before starting it (PAN-4242)', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'pan-4242-launch-repo-')));
    try {
      const root = join(base, 'proj');
      const worktree = join(root, 'workspaces', 'feature-pan-1');
      mkdirSync(root, { recursive: true });
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'ignore' });
      git('init', '-q');
      git('commit', '-q', '--allow-empty', '-m', 'init');
      git('worktree', 'add', '-q', '-b', 'feature/pan-1', worktree);

      let trustedAtStart: Array<boolean | undefined> = [];
      await launchAgentPane({
        issueId: 'PAN-1',
        cwd: `${worktree}/`,
        agentId: 'agent-pan-1',
        argv: ['bash', 'launcher.sh'],
        env: {},
        tokens: { issue: 'PAN-1', role: 'work', harness: 'claude-code', model: 'opus' },
      }, fakeBackend(() => {
        const projects = readProjects();
        trustedAtStart = [projects[worktree]?.hasTrustDialogAccepted, projects[root]?.hasTrustDialogAccepted];
      }));

      expect(trustedAtStart).toEqual([true, true]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
