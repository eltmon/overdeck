/**
 * Review of #4018 (L2): the legacy tmux check tells "no such session" apart
 * from "tmux did not answer". Only the failure classifier is exercised here;
 * nothing touches a real tmux server.
 */
import { describe, expect, it } from 'vitest';

import { classifyHasSessionFailure } from '../../../../src/lib/agents/tmux-session-query.js';

describe('classifyHasSessionFailure', () => {
  it('reads "can\'t find session" as missing', () => {
    expect(classifyHasSessionFailure({ code: 1, stderr: "can't find session: agent-x\n" })).toBe('missing');
  });

  it('reads a tmux server that is not running as missing — a Herdr host usually has none', () => {
    expect(classifyHasSessionFailure({ code: 1, stderr: 'no server running on /tmp/tmux-1000/overdeck\n' })).toBe('missing');
    expect(classifyHasSessionFailure({
      code: 1,
      stderr: 'error connecting to /tmp/tmux-1000/overdeck (No such file or directory)\n',
    })).toBe('missing');
  });

  it('reads a host with no tmux binary as missing: it can hold no session', () => {
    expect(classifyHasSessionFailure({ code: 'ENOENT', stderr: '' })).toBe('missing');
  });

  it('reads no tmux binary as error when the caller requires tmux (a tmux-backend host)', () => {
    expect(classifyHasSessionFailure({ code: 'ENOENT', stderr: '' }, { noBinary: 'error' })).toBe('error');
    // A clean "no such session" is still missing there.
    expect(classifyHasSessionFailure({ code: 1, stderr: "can't find session: agent-x\n" }, { noBinary: 'error' })).toBe('missing');
  });

  it('reads a timeout (the probe was killed) as error', () => {
    expect(classifyHasSessionFailure({ killed: true, stderr: '' })).toBe('error');
  });

  it('reads any other failure as error', () => {
    expect(classifyHasSessionFailure({
      code: 1,
      stderr: 'error connecting to /tmp/tmux-1000/overdeck (Permission denied)\n',
    })).toBe('error');
    expect(classifyHasSessionFailure(new Error('boom'))).toBe('error');
  });
});
