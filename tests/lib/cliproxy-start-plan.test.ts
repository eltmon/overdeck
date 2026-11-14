import { describe, expect, it } from 'vitest';
import { planCliproxyStart } from '../../src/lib/cliproxy-config.js';

describe('planCliproxyStart', () => {
  it('plans a config-only write when a current proxy is running', () => {
    expect(planCliproxyStart({ running: true, binaryCurrent: true })).toBe('write-config-only');
  });

  it('plans an upgrade when a stale proxy is running', () => {
    expect(planCliproxyStart({ running: true, binaryCurrent: false })).toBe('upgrade-running');
  });

  it('plans a write and spawn when a current binary is stopped', () => {
    expect(planCliproxyStart({ running: false, binaryCurrent: true })).toBe('write-spawn');
  });

  it('plans an install, write and spawn when a stale binary is stopped', () => {
    expect(planCliproxyStart({ running: false, binaryCurrent: false })).toBe('install-write-spawn');
  });
});
