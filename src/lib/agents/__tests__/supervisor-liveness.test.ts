import { describe, expect, it } from 'vitest';

import { supervisorProcessAlive, supervisorProcessAliveSync } from '../supervisor-liveness.js';

describe('supervisorProcessAliveSync', () => {
  it('returns true when pgrep finds a supervisor for the agent', () => {
    const patterns: string[] = [];
    const alive = supervisorProcessAliveSync('agent-min-882', (pattern) => {
      patterns.push(pattern);
      return true;
    });
    expect(alive).toBe(true);
    expect(patterns[0]).toContain('pty-supervisor');
    expect(patterns[0]).toContain('--name agent-min-882');
  });

  it('returns false when no supervisor matches', () => {
    expect(supervisorProcessAliveSync('agent-min-882', () => false)).toBe(false);
  });

  it('anchors --name so the base agent does not match its specialists', () => {
    let pattern = '';
    supervisorProcessAliveSync('agent-min-882', (p) => { pattern = p; return false; });
    // Trailing boundary: agent-min-882 must not match agent-min-882-review.
    expect(pattern).toContain('--name agent-min-882(\\s|$)');
  });

  it('returns false for an empty agent id without invoking pgrep', () => {
    let called = false;
    expect(supervisorProcessAliveSync('', () => { called = true; return true; })).toBe(false);
    expect(called).toBe(false);
  });

  it('supports the same boundary-anchored probe without blocking the server', async () => {
    let pattern = '';
    await expect(supervisorProcessAlive('strike-pan-2702', async (value) => {
      pattern = value;
      return true;
    })).resolves.toBe(true);
    expect(pattern).toContain('--name strike-pan-2702(\\s|$)');
  });
});
