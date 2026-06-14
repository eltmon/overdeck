import { describe, expect, it, vi, beforeEach } from 'vitest';
import { conversationRuntimeRootPids } from '../conversations.js';
import { findManagedServerPidSync } from '../../../../lib/tmux.js';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: vi.fn(() => '/home/user'),
  };
});

vi.mock('../../../../lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tmux.js')>('../../../lib/tmux.js');
  return {
    ...actual,
    findManagedServerPidSync: vi.fn(),
  };
});

const mockedFindManagedServerPidSync = vi.mocked(findManagedServerPidSync);

describe('conversationRuntimeRootPids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes the shared tmux server PID from cmdline-matched roots (PAN-1798)', () => {
    mockedFindManagedServerPidSync.mockReturnValue(99999);

    const conv = {
      tmuxSession: 'conv-20260612-3871',
      claudeSessionId: 'sess-3871',
    } as any;

    const panopticonHome = process.env.PANOPTICON_HOME ?? '/home/user/.panopticon';
    const rows = [
      { pid: 1, ppid: 0, args: `tmux -L panopticon new-session -d -s conv-20260612-3871 bash ${panopticonHome}/conversations/conv-20260612-3871/launcher.sh` },
      { pid: 2, ppid: 1, args: `bash ${panopticonHome}/conversations/conv-20260612-3871/launcher.sh` },
      { pid: 99999, ppid: 0, args: 'tmux -L panopticon new-session -d -s conv-20260612-3871 bash launcher.sh' },
      { pid: process.pid, ppid: 0, args: 'node dashboard/server.js' },
    ];

    const pids = conversationRuntimeRootPids(conv, rows);

    expect(pids).toContain(1);
    expect(pids).toContain(2);
    expect(pids).not.toContain(99999);
    expect(pids).not.toContain(process.pid);
  });

  it('matches launcher path and session-id needles when no server PID is found', () => {
    mockedFindManagedServerPidSync.mockReturnValue(undefined);

    const conv = {
      tmuxSession: 'conv-20260612-4808',
      claudeSessionId: 'sess-4808',
    } as any;

    const rows = [
      { pid: 100, ppid: 0, args: 'claude --session-id sess-4808' },
      { pid: 101, ppid: 100, args: 'node pty-supervisor.js' },
      { pid: 200, ppid: 0, args: 'some-other-process' },
    ];

    const pids = conversationRuntimeRootPids(conv, rows);

    expect(pids).toContain(100);
    expect(pids).not.toContain(200);
  });
});
