import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PRIME_AGENT_SOCKET_PATH_MAX_BYTES,
  PrimeAgentSocketPathTooLong,
  isPrimeAgentDaemonSocketPath,
  isPrimeAgentSessionPath,
  primeAgentDaemonSocketPath,
  primeAgentSessionDir,
  primeAgentSessionFilePointerPath,
  readPrimeAgentSessionFile,
} from '../prime-agent.js';

describe('Prime Agent storage paths (PAN-3668 WI-7)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'prime-storage-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('puts sessions and the session-file pointer in the agent directory', () => {
    expect(primeAgentSessionDir('agent-pan-1', root)).toBe(join(root, 'agent-pan-1', 'prime-sessions'));
    expect(primeAgentSessionFilePointerPath('agent-pan-1', root)).toBe(join(root, 'agent-pan-1', 'prime-agent-session-file'));
    expect(isPrimeAgentSessionPath(join(root, 'agent-pan-1', 'prime-sessions', '01a0.jsonl'))).toBe(true);
    expect(isPrimeAgentSessionPath(join(root, 'agent-pan-1', 'acp-session.jsonl'))).toBe(false);
  });

  it('rejects agent identities that could escape the agents root', () => {
    expect(() => primeAgentSessionDir('../etc', root)).toThrow('Invalid Prime Agent agent identity');
  });

  it('builds a short hashed daemon socket under OVERDECK_HOME/sockets', () => {
    const home = '/home/op/.overdeck';
    const socket = primeAgentDaemonSocketPath('agent-pan-3668', home);
    expect(socket).toMatch(/^\/home\/op\/\.overdeck\/sockets\/pd-[0-9a-f]{16}\.sock$/);
    expect(primeAgentDaemonSocketPath('agent-pan-3668', home)).toBe(socket);
    expect(primeAgentDaemonSocketPath('agent-pan-3669', home)).not.toBe(socket);
    expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(PRIME_AGENT_SOCKET_PATH_MAX_BYTES);
    expect(isPrimeAgentDaemonSocketPath(socket, home)).toBe(true);
    expect(isPrimeAgentDaemonSocketPath('/tmp/prime-agent-1000/daemon.sock', home)).toBe(false);
  });

  it('throws PrimeAgentSocketPathTooLong naming the path when OVERDECK_HOME is too long', () => {
    const home = `/${'x'.repeat(90)}`;
    let error: unknown;
    try {
      primeAgentDaemonSocketPath('agent-pan-3668', home);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PrimeAgentSocketPathTooLong);
    const tooLong = error as PrimeAgentSocketPathTooLong;
    expect(tooLong.bytes).toBeGreaterThan(PRIME_AGENT_SOCKET_PATH_MAX_BYTES);
    expect(tooLong.message).toContain(tooLong.path);
    expect(tooLong.message).toContain(`${tooLong.bytes} bytes`);
  });

  it('reads the recorded session file only when the pointer target exists', async () => {
    expect(await readPrimeAgentSessionFile('agent-pan-1', root)).toBeNull();

    const sessionFile = join(primeAgentSessionDir('agent-pan-1', root), '01a0d716.jsonl');
    await mkdir(join(root, 'agent-pan-1'), { recursive: true });
    await writeFile(primeAgentSessionFilePointerPath('agent-pan-1', root), `${sessionFile}\n`);
    expect(await readPrimeAgentSessionFile('agent-pan-1', root)).toBeNull();

    await mkdir(primeAgentSessionDir('agent-pan-1', root), { recursive: true });
    await writeFile(sessionFile, '{"type":"session"}\n');
    expect(await readPrimeAgentSessionFile('agent-pan-1', root)).toBe(sessionFile);
  });
});
