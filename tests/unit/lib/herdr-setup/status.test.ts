import { describe, expect, it, vi } from 'vitest';

import {
  defaultHerdrExec,
  parseHerdrStatus,
  readHerdrStatus,
  type HerdrExec,
} from '../../../../src/lib/herdr-setup/status.js';
import { STATUS_NOT_RUNNING_JSON, STATUS_RUNNING_JSON } from './fixtures.js';

describe('parseHerdrStatus (PAN-3956 W5)', () => {
  it('parses the recorded running-server status', () => {
    expect(parseHerdrStatus(STATUS_RUNNING_JSON)).toEqual({
      client: { version: '0.9.1', channel: 'stable', protocol: 22, binary: '/home/eltmon/.local/bin/herdr' },
      server: {
        running: true,
        version: '0.9.1',
        protocol: 22,
        endpointCompatible: true,
        socket: '/home/eltmon/.config/herdr/sessions/overdeck/herdr.sock',
        restartNeeded: false,
        serverBinaryStale: false,
      },
    });
  });

  it('parses the recorded no-server status (null version and compatibility)', () => {
    const status = parseHerdrStatus(STATUS_NOT_RUNNING_JSON);
    expect(status?.server).toEqual({
      running: false,
      endpointCompatible: false,
      socket: '/home/eltmon/.config/herdr/sessions/pan3956-probe-nonexistent/herdr.sock',
      restartNeeded: false,
      serverBinaryStale: false,
    });
  });

  it('reads restart_needed / server_binary_stale from either block', () => {
    const json = JSON.parse(STATUS_RUNNING_JSON) as Record<string, Record<string, unknown>>;
    json.update = { restart_needed: true, server_binary_stale: false };
    json.server = { ...json.server, server_binary_stale: true };
    const status = parseHerdrStatus(JSON.stringify(json));
    expect(status?.server.restartNeeded).toBe(true);
    expect(status?.server.serverBinaryStale).toBe(true);
  });

  it('is null for text that is not the status JSON', () => {
    expect(parseHerdrStatus('herdr: error: no such session')).toBeNull();
    expect(parseHerdrStatus('{"other":true}')).toBeNull();
  });
});

describe('defaultHerdrExec', () => {
  it('resolves a non-zero exit with the captured output', async () => {
    const result = await defaultHerdrExec('sh', ['-c', 'echo out; echo err >&2; exit 3']);
    expect(result).toEqual({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 });
  });

  it('rejects when the binary cannot be spawned', async () => {
    await expect(defaultHerdrExec('/nonexistent/pan-3956/herdr', ['--version'])).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('readHerdrStatus', () => {
  it('runs `--session <s> status --json` and parses it', async () => {
    const exec = vi.fn<HerdrExec>(async () => ({ stdout: `${STATUS_RUNNING_JSON}\n`, stderr: '', exitCode: 0 }));
    const status = await readHerdrStatus('/bin/herdr', 'overdeck', exec);
    expect(exec).toHaveBeenCalledWith('/bin/herdr', ['--session', 'overdeck', 'status', '--json']);
    expect(status?.server.running).toBe(true);
  });

  it('still parses the JSON when the exit code is non-zero', async () => {
    const exec: HerdrExec = async () => ({ stdout: STATUS_NOT_RUNNING_JSON, stderr: '', exitCode: 1 });
    const status = await readHerdrStatus('/bin/herdr', 'x', exec);
    expect(status?.server.running).toBe(false);
  });

  it('is null when the binary cannot be spawned (ENOENT)', async () => {
    const exec: HerdrExec = async () => {
      throw Object.assign(new Error('spawn herdr ENOENT'), { code: 'ENOENT' });
    };
    await expect(readHerdrStatus('/missing/herdr', 'overdeck', exec)).resolves.toBeNull();
  });
});
