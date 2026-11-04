import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectDoctor, filterExecArgv } from '../../../../src/lib/diagnostics/collect-doctor.js';

interface FakeChild {
  child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  emitData: (stream: 'stdout' | 'stderr', text: string) => void;
  finish: (code: number | null, signal: string | null) => void;
}

function makeFakeChild(): FakeChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = Object.assign(new EventEmitter(), { stdout, stderr, kill: vi.fn() });

  return {
    child,
    emitData: (stream, text) => (stream === 'stdout' ? stdout : stderr).emit('data', Buffer.from(text)),
    finish: (code, signal) => child.emit('exit', code, signal),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('filterExecArgv', () => {
  it('drops --inspect, --inspect-brk and --inspect-port, with or without =value', () => {
    const input = ['--inspect', '--inspect=9229', '--inspect-brk', '--inspect-brk=9230', '--inspect-port=9231', '--trace-warnings'];
    expect(filterExecArgv(input)).toEqual(['--trace-warnings']);
  });

  it('leaves unrelated flags untouched', () => {
    expect(filterExecArgv(['--max-old-space-size=4096'])).toEqual(['--max-old-space-size=4096']);
  });
});

describe('collectDoctor', () => {
  it('parses a valid doctor JSON report into doctor.json with no failure, even on exit code 1', async () => {
    const { child, emitData, finish } = makeFakeChild();
    const spawnMock = vi.fn().mockReturnValue(child);
    const report = { schemaVersion: 1, exitCode: 1, checks: [{ name: 'Git', status: 'ok', message: 'Installed', fix: null }] };

    const promise = collectDoctor({ spawn: spawnMock as any, execPath: '/node', execArgv: [], cliEntry: '/pan/cli.js' });
    emitData('stdout', JSON.stringify(report));
    finish(1, null);
    const outcome = await promise;

    expect(outcome.failures).toEqual([]);
    expect(outcome.entries).toHaveLength(1);
    expect(outcome.entries[0].path).toBe('doctor.json');
    expect(JSON.parse(outcome.entries[0].content)).toEqual(report);
  });

  it('falls back to doctor-output.txt with a failure when stdout does not parse as a doctor report', async () => {
    const { child, emitData, finish } = makeFakeChild();
    const spawnMock = vi.fn().mockReturnValue(child);

    const promise = collectDoctor({ spawn: spawnMock as any, execPath: '/node', execArgv: [], cliEntry: '/pan/cli.js' });
    emitData('stdout', 'not json at all');
    emitData('stderr', 'some crash output');
    finish(0, null);
    const outcome = await promise;

    expect(outcome.entries).toHaveLength(1);
    expect(outcome.entries[0].path).toBe('doctor-output.txt');
    expect(outcome.entries[0].content).toContain('not json at all');
    expect(outcome.entries[0].content).toContain('some crash output');
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]).toEqual({ source: 'pan doctor --json', reason: 'stdout did not parse as a doctor JSON report' });
  });

  it('kills a child that never exits after timeoutMs, recording a timeout failure', async () => {
    vi.useFakeTimers();

    const { child } = makeFakeChild();
    const spawnMock = vi.fn().mockReturnValue(child);

    const promise = collectDoctor({ spawn: spawnMock as any, execPath: '/node', execArgv: [], cliEntry: '/pan/cli.js', timeoutMs: 120_000 });
    await vi.advanceTimersByTimeAsync(120_000);
    const outcome = await promise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(outcome.entries[0].path).toBe('doctor-output.txt');
    expect(outcome.failures[0]).toEqual({ source: 'pan doctor --json', reason: 'timed out after 120s' });
  });

  it('spawns with argv equal to [...execArgv, cliEntry, "doctor", "--json"]', async () => {
    const { child, emitData, finish } = makeFakeChild();
    const spawnMock = vi.fn().mockReturnValue(child);

    const promise = collectDoctor({
      spawn: spawnMock as any,
      execPath: '/usr/bin/node',
      execArgv: ['--max-old-space-size=4096'],
      cliEntry: '/overdeck/dist/cli/index.js',
    });
    emitData('stdout', JSON.stringify({ schemaVersion: 1, checks: [] }));
    finish(0, null);
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['--max-old-space-size=4096', '/overdeck/dist/cli/index.js', 'doctor', '--json'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });
});
