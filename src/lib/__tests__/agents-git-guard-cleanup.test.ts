import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../paths.js')>();
  return {
    ...actual,
    get AGENTS_DIR() {
      return join(process.env.TEST_GIT_GUARD_HOME!, 'agents');
    },
  };
});

vi.mock('../tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmux.js')>();
  return {
    ...actual,
    sessionExistsSync: vi.fn(() => false),
    capturePaneSync: vi.fn(() => ''),
    killSessionSync: vi.fn(),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn(() => {
      throw new Error('no launcher process');
    }),
  };
});

vi.mock('../overdeck/agent-state-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../overdeck/agent-state-sync.js')>();
  return { ...actual, getOverdeckAgentStateSync: vi.fn(() => null) };
});

vi.mock('../overdeck/agent-rollback-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../overdeck/agent-rollback-state.js')>();
  return { ...actual, readRollbackAgentStateSync: vi.fn(() => null) };
});

vi.mock('../agent-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent-runtime.js')>();
  const { Effect } = await import('effect');
  return { ...actual, emitAgentEvent: vi.fn(() => Effect.void) };
});

import { stopAgentSync } from '../agents.js';

let testHome: string;

beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-806-guard-cleanup-'));
  process.env.TEST_GIT_GUARD_HOME = testHome;
});

beforeEach(() => {
  rmSync(join(testHome, 'agents'), { recursive: true, force: true });
  mkdirSync(join(testHome, 'agents'), { recursive: true });
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
  delete process.env.TEST_GIT_GUARD_HOME;
});

describe('stopAgentSync git guard cleanup', () => {
  it('removes the per-agent git guard directory', () => {
    const guardDir = join(testHome, 'agents', 'agent-pan-806', 'git-guard');
    mkdirSync(guardDir, { recursive: true });
    writeFileSync(join(guardDir, 'git'), '#!/bin/sh\n');

    stopAgentSync('agent-pan-806');

    expect(existsSync(guardDir)).toBe(false);
  });

  it('does not throw when the git guard directory is absent', () => {
    expect(() => stopAgentSync('agent-pan-806')).not.toThrow();
  });
});
