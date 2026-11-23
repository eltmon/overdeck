import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));

import { resetHostToolsForTests, setHostToolFinderForTests } from '../../host-tools.js';
import {
  COMPOSE_PS_FORMAT,
  listComposeContainers,
  parseComposePs,
  parseStatsMemory,
  readContainerMemoryBytes,
  startContainer,
  stopContainer,
} from '../stack-reclaim-docker.js';

type Callback = (err: unknown, out?: unknown) => void;

function dockerAnswers(stdout: string): void {
  mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Callback) => {
    cb(null, { stdout, stderr: '' });
  });
}

function dockerFails(): void {
  mocks.execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Callback) => {
    cb(new Error('Cannot connect to the Docker daemon'));
  });
}

beforeEach(() => {
  mocks.execFile.mockReset();
  setHostToolFinderForTests(() => '/fake/bin/docker');
});

afterEach(() => {
  resetHostToolsForTests();
});

describe('parseComposePs (PAN-5623)', () => {
  it('keeps compose rows and drops label-less rows', () => {
    const stdout = [
      'a1\tmyn-feature-min-1142-api-1\trunning\tmyn-feature-min-1142\tapi',
      'b2\tmyn-feature-min-1142-postgres-1\trunning\tmyn-feature-min-1142\tpostgres',
      'c3\topen-design\trunning\topen-design\topen-design',
      'd4\tstray\trunning\t\t',
      '',
    ].join('\n');
    expect(parseComposePs(stdout)).toEqual([
      { id: 'a1', name: 'myn-feature-min-1142-api-1', state: 'running', composeProject: 'myn-feature-min-1142', composeService: 'api' },
      { id: 'b2', name: 'myn-feature-min-1142-postgres-1', state: 'running', composeProject: 'myn-feature-min-1142', composeService: 'postgres' },
      { id: 'c3', name: 'open-design', state: 'running', composeProject: 'open-design', composeService: 'open-design' },
    ]);
  });

  it('drops rows with fewer than five fields', () => {
    expect(parseComposePs('a1\tname\trunning\tproject')).toEqual([]);
  });
});

describe('parseStatsMemory (PAN-5623)', () => {
  it('maps a container name to the bytes it uses', () => {
    expect(parseStatsMemory('myn-feature-min-1142-api-1\t1.2GiB / 62GiB\n')).toEqual(
      new Map([['myn-feature-min-1142-api-1', 1.2 * 1024 ** 3]]),
    );
  });
});

describe('docker wrappers (PAN-5623)', () => {
  it('lists with an argument array, adding -a only when asked', async () => {
    dockerAnswers('a1\tx-api-1\trunning\tx\tapi\n');
    await expect(listComposeContainers({ all: false })).resolves.toHaveLength(1);
    expect(mocks.execFile.mock.calls[0]?.[0]).toBe('/fake/bin/docker');
    expect(mocks.execFile.mock.calls[0]?.[1]).toEqual(['ps', '--format', COMPOSE_PS_FORMAT]);

    await listComposeContainers({ all: true });
    expect(mocks.execFile.mock.calls[1]?.[1]).toEqual(['ps', '-a', '--format', COMPOSE_PS_FORMAT]);
  });

  it('returns null or a failure when docker rejects', async () => {
    dockerFails();
    await expect(listComposeContainers({ all: true })).resolves.toBeNull();
    await expect(readContainerMemoryBytes(['x-api-1'])).resolves.toBeNull();
    await expect(stopContainer('abc123')).resolves.toMatchObject({ ok: false });
    await expect(startContainer('x-api-1')).resolves.toMatchObject({ ok: false });
  });

  it('returns null without spawning when docker is missing', async () => {
    resetHostToolsForTests();
    setHostToolFinderForTests(() => null);
    await expect(listComposeContainers({ all: false })).resolves.toBeNull();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('stops and starts with argument arrays', async () => {
    dockerAnswers('');
    await expect(stopContainer('abc123')).resolves.toEqual({ ok: true });
    await expect(startContainer('x-api-1')).resolves.toEqual({ ok: true });
    expect(mocks.execFile.mock.calls.map((call) => call[1])).toEqual([['stop', 'abc123'], ['start', 'x-api-1']]);
  });

  it('refuses an invalid name without calling execFile', async () => {
    dockerAnswers('');
    await expect(stopContainer('a;rm -rf /')).resolves.toEqual({ ok: false, error: 'invalid container name' });
    await expect(startContainer('a;rm -rf /')).resolves.toEqual({ ok: false, error: 'invalid container name' });
    await expect(startContainer('--privileged')).resolves.toEqual({ ok: false, error: 'invalid container name' });
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('drops invalid names from the stats call and spawns nothing for an empty list', async () => {
    await expect(readContainerMemoryBytes([])).resolves.toEqual(new Map());
    await expect(readContainerMemoryBytes(['a;rm -rf /'])).resolves.toEqual(new Map());
    expect(mocks.execFile).not.toHaveBeenCalled();

    dockerAnswers('x-api-1\t512MiB / 62GiB\n');
    await expect(readContainerMemoryBytes(['x-api-1', 'a;rm -rf /'])).resolves.toEqual(new Map([['x-api-1', 512 * 1024 ** 2]]));
    expect(mocks.execFile.mock.calls[0]?.[1]).toEqual(['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}', 'x-api-1']);
  });
});
