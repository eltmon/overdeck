import { describe, expect, it, vi } from 'vitest';
import { PrimeAgentResumeError, resumePrimeAgentSession } from '../../../../src/lib/prime-agent/session-resume.js';

describe('resumePrimeAgentSession', () => {
  it('returns a process only when get_state confirms the persisted session ID', async () => {
    const process = { getState: vi.fn(async () => ({ sessionId: 'session-1' })), stop: vi.fn(async () => undefined) };
    const start = vi.fn(async () => process);
    await expect(resumePrimeAgentSession({ sessionId: 'session-1', sessionPath: '/sessions/one.jsonl', start, accessFile: async () => undefined })).resolves.toBe(process);
    expect(start).toHaveBeenCalledWith('/sessions/one.jsonl');
    expect(process.stop).not.toHaveBeenCalled();
  });

  it('rejects a missing session before starting a process', async () => {
    const start = vi.fn();
    await expect(resumePrimeAgentSession({ sessionId: 'session-1', sessionPath: '/missing.jsonl', start, accessFile: async () => { throw new Error('ENOENT'); } })).rejects.toThrow('No fresh session was created');
    expect(start).not.toHaveBeenCalled();
  });

  it('stops a process whose get_state session ID does not match', async () => {
    const process = { getState: vi.fn(async () => ({ sessionId: 'wrong' })), stop: vi.fn(async () => undefined) };
    await expect(resumePrimeAgentSession({ sessionId: 'session-1', sessionPath: '/sessions/one.jsonl', start: async () => process, accessFile: async () => undefined })).rejects.toBeInstanceOf(PrimeAgentResumeError);
    expect(process.stop).toHaveBeenCalledOnce();
  });

  it('stops the replacement process when it exits during state verification', async () => {
    const process = { getState: vi.fn(async () => { throw new Error('process exited'); }), stop: vi.fn(async () => undefined) };
    await expect(resumePrimeAgentSession({ sessionId: 'session-1', sessionPath: '/sessions/one.jsonl', start: async () => process, accessFile: async () => undefined })).rejects.toThrow('process exited');
    expect(process.stop).toHaveBeenCalledOnce();
  });
});
