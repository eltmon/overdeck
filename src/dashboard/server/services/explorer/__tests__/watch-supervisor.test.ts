import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorerWatchEvent } from '@overdeck/contracts';
import type { ChildToSupervisor, SupervisorToChild } from '../watch-protocol.js';
import {
  createExplorerWatchSupervisor,
  resolveWatchChildScript,
  type ExplorerWatchSupervisor,
  type WatchSpec,
} from '../watch-supervisor.js';

/** A forked child stand-in that heartbeats every 5 s until `silence()`. */
class FakeChild extends EventEmitter {
  readonly sent: SupervisorToChild[] = [];
  readonly stderr = new EventEmitter();
  readonly pid: number;
  connected = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    this.die(null, signal);
    return true;
  });
  private readonly beat: ReturnType<typeof setInterval>;

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.beat = setInterval(() => this.emitMessage({ type: 'heartbeat' }), 5000);
  }

  send(msg: SupervisorToChild): boolean {
    if (!this.connected) throw new Error('ERR_IPC_CHANNEL_CLOSED');
    this.sent.push(msg);
    return true;
  }

  emitMessage(msg: ChildToSupervisor): void {
    if (this.connected) this.emit('message', msg);
  }

  silence(): void {
    clearInterval(this.beat);
  }

  /** The process ends: no more messages, then `exit`. */
  die(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (!this.connected) return;
    this.silence();
    this.connected = false;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

let children: FakeChild[];
let logs: string[];
let supervisor: ExplorerWatchSupervisor;
let fork: ReturnType<typeof vi.fn>;

const project: WatchSpec = { id: 'project:p', absPath: '/repo', kind: 'project' };
const issue: WatchSpec = { id: 'issue:PAN-1', absPath: '/repo/workspaces/feature-pan-1', kind: 'issue' };
const OVERFLOW = [{ kind: 'overflow', path: '' }];

function recorder() {
  const batches: ExplorerWatchEvent[][] = [];
  return { batches, listener: (events: ExplorerWatchEvent[]) => batches.push(events) };
}

const lastChild = () => children.at(-1)!;
const messagesOf = (type: SupervisorToChild['type']) => children.flatMap((c) => c.sent.filter((m) => m.type === type));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  children = [];
  logs = [];
  fork = vi.fn(() => {
    const child = new FakeChild(1000 + children.length);
    children.push(child);
    return child;
  });
  supervisor = createExplorerWatchSupervisor({
    fork: fork as never,
    scriptPath: '/dist/dashboard/explorer-watch-child.js',
    listTopLevelIgnored: async () => ['node_modules'],
    log: (line) => logs.push(line),
  });
});

afterEach(async () => {
  await supervisor.dispose();
  for (const child of children) child.silence();
  vi.useRealTimers();
});

describe('explorer watch supervisor', () => {
  it('forks lazily and adds workspaces to project roots only', async () => {
    expect(fork).not.toHaveBeenCalled();
    await supervisor.subscribe(project, () => {});
    expect(fork).toHaveBeenCalledTimes(1);
    await supervisor.subscribe(issue, () => {});
    expect(fork).toHaveBeenCalledTimes(1);
    expect(messagesOf('watch')).toEqual([
      { type: 'watch', rootId: 'project:p', absPath: '/repo', topLevelDirs: ['node_modules', 'workspaces'] },
      { type: 'watch', rootId: 'issue:PAN-1', absPath: issue.absPath, topLevelDirs: ['node_modules'] },
    ]);
  });

  it('sends one watch and one unwatch for two listeners on one root', async () => {
    const [a, b] = await Promise.all([supervisor.subscribe(issue, () => {}), supervisor.subscribe(issue, () => {})]);
    expect(messagesOf('watch')).toHaveLength(1);
    a();
    expect(messagesOf('unwatch')).toHaveLength(0);
    b();
    b();
    expect(messagesOf('unwatch')).toEqual([{ type: 'unwatch', rootId: 'issue:PAN-1' }]);
  });

  it('delivers events only to that root', async () => {
    const p = recorder();
    const i = recorder();
    await supervisor.subscribe(project, p.listener);
    await supervisor.subscribe(issue, i.listener);
    lastChild().emitMessage({ type: 'events', rootId: 'issue:PAN-1', events: [{ kind: 'update', path: 'a.ts' }] });
    expect(i.batches).toEqual([[{ kind: 'update', path: 'a.ts' }]]);
    expect(p.batches).toEqual([]);
  });

  it('replaces a child that stops heartbeating', async () => {
    const p = recorder();
    const i = recorder();
    await supervisor.subscribe(project, p.listener);
    await supervisor.subscribe(issue, i.listener);
    const first = lastChild();
    first.silence();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(first.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(first.kill).toHaveBeenCalledWith('SIGKILL');
    expect(fork).toHaveBeenCalledTimes(2);
    expect(lastChild().sent.filter((m) => m.type === 'watch').map((m) => m.rootId)).toEqual(['project:p', 'issue:PAN-1']);
    expect(p.batches).toEqual([OVERFLOW]);
    expect(i.batches).toEqual([OVERFLOW]);
  });

  it('falls back to polling after the fourth crash in 5 minutes', async () => {
    const p = recorder();
    await supervisor.subscribe(project, p.listener);
    for (let crash = 0; crash < 4; crash++) {
      lastChild().die(1);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(fork).toHaveBeenCalledTimes(4);
    expect(logs).toContain('[explorer-watch] polling fallback');
    const before = p.batches.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(p.batches.length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.batches.length).toBe(before + 3);
    expect(p.batches.at(-1)).toEqual(OVERFLOW);
    expect(fork).toHaveBeenCalledTimes(4);
  });

  it('polls a root the child could not watch while others get real events', async () => {
    const p = recorder();
    const i = recorder();
    await supervisor.subscribe(project, p.listener);
    await supervisor.subscribe(issue, i.listener);
    lastChild().emitMessage({ type: 'watch-failed', rootId: 'project:p', message: 'ENOSPC' });
    expect(logs).toContain('[explorer-watch] polling fallback root=project:p: ENOSPC');
    await vi.advanceTimersByTimeAsync(5000);
    lastChild().emitMessage({ type: 'events', rootId: 'issue:PAN-1', events: [{ kind: 'create', path: 'n.ts' }] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(p.batches).toEqual([OVERFLOW, OVERFLOW]);
    expect(i.batches).toEqual([[{ kind: 'create', path: 'n.ts' }]]);
  });

  it('kills an idle child after 60 s without counting it as a crash', async () => {
    const unsubscribe = await supervisor.subscribe(issue, () => {});
    unsubscribe();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(lastChild().kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(lastChild().kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('keeps the child when a subscriber returns within 60 s', async () => {
    const unsubscribe = await supervisor.subscribe(issue, () => {});
    unsubscribe();
    await vi.advanceTimersByTimeAsync(30_000);
    await supervisor.subscribe(issue, () => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lastChild().kill).not.toHaveBeenCalled();
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('never sends to a closed child channel', async () => {
    await supervisor.subscribe(issue, () => {});
    const child = lastChild();
    child.connected = false;
    expect(() => child.emit('exit', 1, null)).not.toThrow();
  });

  it('forwards child stderr lines to the log', async () => {
    await supervisor.subscribe(issue, () => {});
    lastChild().stderr.emit('data', Buffer.from('line one\nline '));
    lastChild().stderr.emit('data', Buffer.from('two\n'));
    expect(logs).toEqual(
      expect.arrayContaining(['[explorer-watch-child] line one', '[explorer-watch-child] line two']),
    );
  });
});

describe('resolveWatchChildScript', () => {
  it('points at the dist entry from a dist chunk', () => {
    expect(resolveWatchChildScript('file:///x/dist/dashboard/chunk-a.js')).toBe('/x/dist/dashboard/explorer-watch-child.js');
  });

  it('points at the TypeScript entry from source', () => {
    expect(resolveWatchChildScript('file:///x/src/dashboard/server/services/explorer/watch-supervisor.ts')).toMatch(
      /\/watch-child\.ts$/,
    );
  });
});
