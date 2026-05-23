import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPtyTokenPath, PTY_TOKEN_HEADER, readPtyTokenSync, writePtyTokenSync } from '../pty-token.js';

let tmpHome: string;
let previousPanopticonHome: string | undefined;

beforeEach(() => {
  previousPanopticonHome = process.env.PANOPTICON_HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'pan-pty-token-'));
  process.env.PANOPTICON_HOME = tmpHome;
});

afterEach(() => {
  if (previousPanopticonHome === undefined) {
    delete process.env.PANOPTICON_HOME;
  } else {
    process.env.PANOPTICON_HOME = previousPanopticonHome;
  }
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('pty-token', () => {
  it('writes and reads back a 32-byte hex token', () => {
    const token = writePtyTokenSync('agent-test');

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(readPtyTokenSync('agent-test')).toBe(token);
  });

  it('returns null when the token file does not exist', () => {
    expect(readPtyTokenSync('missing-agent')).toBeNull();
  });

  it('writes the token under the agent directory with mode 0600', () => {
    const token = writePtyTokenSync('agent-mode');
    const path = getPtyTokenPath('agent-mode');

    expect(path).toBe(join(tmpHome, 'agents', 'agent-mode', 'pty-token'));
    expect(readPtyTokenSync('agent-mode')).toBe(token);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('exports a distinct PTY token header', () => {
    expect(PTY_TOKEN_HEADER).toBe('x-panopticon-pty-token');
  });
});
