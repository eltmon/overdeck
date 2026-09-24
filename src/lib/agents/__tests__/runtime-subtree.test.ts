import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeName } from '../../runtimes/types.js';
import { findAgentRuntimePidInSubtree } from '../runtime-pid-probe.js';

// Moved here from src/lib/agents/runtime-command.ts, which no production code called (PAN-3958 CH-8).
/**
 * True when the pane's process subtree contains the expected harness runtime.
 * The walk lives in runtime-pid-probe.ts (PAN-3849) so the liveness oracle and
 * its no-loss audit share one mockable boundary.
 */
async function hasAgentRuntimeInSubtree(rootPid: string, harness: RuntimeName = 'claude-code'): Promise<boolean> {
  return (await findAgentRuntimePidInSubtree(rootPid, harness)) !== null;
}

/**
 * PAN-3879 — `hasAgentRuntimeInSubtree` must know the runtime binaries per
 * harness. Codex app-server sessions exec `node dist/codex-app-server-host.js`,
 * so the pane comm is `node`, not `codex`; matching bare `node` would
 * false-positive on any node child, so the host script is matched in the full
 * command line instead.
 */

type ProcInfo = { comm: string; args: string };

let procs: Record<string, ProcInfo> = {};
let children: Record<string, string[]> = {};

const execMocks = vi.hoisted(() => ({
  exec: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: execMocks.exec };
});

function noSuchProcess(): NodeJS.ErrnoException {
  return Object.assign(new Error('ps: no such process'), { code: 1 });
}

function installProcTable(nextProcs: Record<string, ProcInfo>, nextChildren: Record<string, string[]>): void {
  procs = nextProcs;
  children = nextChildren;
  execMocks.exec.mockImplementation((cmd: string, cb: (err: unknown, result?: { stdout: string }) => void) => {
    const pidMatch = /ps -p (\d+)/.exec(cmd);
    if (cmd.startsWith('pgrep -P ')) {
      const parent = cmd.slice('pgrep -P '.length).trim();
      const kids = children[parent] ?? [];
      if (kids.length === 0) {
        cb(Object.assign(new Error('pgrep: no children'), { code: 1 }));
      } else {
        cb(null, { stdout: `${kids.join('\n')}\n` });
      }
      return;
    }
    if (pidMatch && cmd.includes('-o comm=')) {
      const info = procs[pidMatch[1]!];
      if (!info) {
        cb(noSuchProcess());
      } else {
        cb(null, { stdout: `${info.comm}\n` });
      }
      return;
    }
    if (pidMatch && cmd.includes('-o args=')) {
      const info = procs[pidMatch[1]!];
      if (!info) {
        cb(noSuchProcess());
      } else {
        cb(null, { stdout: `${info.args}\n` });
      }
      return;
    }
    cb(noSuchProcess());
  });
}


describe('hasAgentRuntimeInSubtree (PAN-3879)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds a live claude process by comm', async () => {
    installProcTable(
      { '100': { comm: 'bash', args: 'bash launcher.sh' }, '101': { comm: 'claude', args: 'claude --model x' } },
      { '100': ['101'] },
    );

    await expect(hasAgentRuntimeInSubtree('100', 'claude-code')).resolves.toBe(true);
  });

  it('finds acp-host for opencode and acp harnesses', async () => {
    installProcTable(
      { '100': { comm: 'bash', args: 'bash launcher.sh' }, '101': { comm: 'acp-host', args: 'acp-host --model y' } },
      { '100': ['101'] },
    );

    await expect(hasAgentRuntimeInSubtree('100', 'opencode')).resolves.toBe(true);
    await expect(hasAgentRuntimeInSubtree('100', 'acp')).resolves.toBe(true);
    await expect(hasAgentRuntimeInSubtree('100', 'claude-code')).resolves.toBe(false);
  });

  it('finds the codex app-server host by its script name in args', async () => {
    installProcTable(
      {
        '100': { comm: 'bash', args: 'bash' },
        '101': { comm: 'node', args: "node '/opt/overdeck/dist/codex-app-server-host.js' --effort high" },
      },
      { '100': ['101'] },
    );

    await expect(hasAgentRuntimeInSubtree('100', 'codex')).resolves.toBe(true);
  });

  it('does not match an unrelated node process for the codex harness', async () => {
    installProcTable(
      {
        '100': { comm: 'bash', args: 'bash' },
        '101': { comm: 'node', args: 'node server.js' },
      },
      { '100': ['101'] },
    );

    await expect(hasAgentRuntimeInSubtree('100', 'codex')).resolves.toBe(false);
  });

  it('returns false for a bare shell with no runtime descendant', async () => {
    installProcTable(
      { '100': { comm: 'bash', args: 'bash' } },
      {},
    );

    await expect(hasAgentRuntimeInSubtree('100', 'claude-code')).resolves.toBe(false);
    await expect(hasAgentRuntimeInSubtree('100', 'codex')).resolves.toBe(false);
  });
});
