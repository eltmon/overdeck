/**
 * PAN-4012 review: `sessionQueryFailure` classifies a failed `has-session` from
 * either error shape: `execFileSync`'s `status`, or a promisified `execFile`
 * error, which carries the exit code as a numeric `code` and no `status`. These
 * tests build the errors the way Node does — real child processes that exit 1
 * with tmux's stderr — instead of mocking them.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { sessionQueryFailure } from '../tmux.js';

const execFileAsync = promisify(execFile);
const MISSING_STDERR = "can't find session: agent-pan-4012";

async function asyncFailure(stderr: string, exitCode: number): Promise<unknown> {
  try {
    await execFileAsync('sh', ['-c', `printf '%s\\n' "$1" >&2; exit ${exitCode}`, 'sh', stderr], { encoding: 'utf-8' });
  } catch (error) {
    return error;
  }
  throw new Error('expected the child to fail');
}

function syncFailure(stderr: string, exitCode: number): unknown {
  try {
    execFileSync('sh', ['-c', `printf '%s\\n' "$1" >&2; exit ${exitCode}`, 'sh', stderr], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return error;
  }
  throw new Error('expected the child to fail');
}

describe('sessionQueryFailure', () => {
  it('classifies a promisified execFile exit-1 "can\'t find session" as missing', async () => {
    const error = await asyncFailure(MISSING_STDERR, 1) as { code?: unknown; status?: unknown };
    // The shape the async path sees: numeric `code`, no `status`.
    expect(error.code).toBe(1);
    expect(error.status).toBeUndefined();

    const result = sessionQueryFailure(error);
    expect(result.status).toBe('missing');
    expect(result.detail).toContain('exit=1');
  });

  it('classifies an execFileSync exit-1 "can\'t find session" as missing', () => {
    const error = syncFailure(MISSING_STDERR, 1) as { status?: unknown };
    expect(error.status).toBe(1);

    expect(sessionQueryFailure(error).status).toBe('missing');
  });

  it('keeps any other failure an error', async () => {
    expect(sessionQueryFailure(await asyncFailure('no server running on /tmp/tmux', 1)).status).toBe('error');
    expect(sessionQueryFailure(await asyncFailure(MISSING_STDERR, 2)).status).toBe('error');
    const enoent = Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
    const result = sessionQueryFailure(enoent);
    expect(result.status).toBe('error');
    expect(result.detail).toContain('code=ENOENT');
  });
});
