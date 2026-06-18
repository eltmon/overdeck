import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  clearStuckRemediationState,
  readStuckRemediationState,
  type StuckRemediationState,
  writeStuckRemediationState,
} from '../stuck-remediation-state.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

function stateFile(agentId: string): string {
  return join(testHome, 'agents', agentId, 'stuck-remediation.json');
}

describe('stuck-remediation state helpers', () => {
  beforeEach(() => {
    testHome = join(process.cwd(), `.tmp-stuck-remediation-${process.pid}-${Date.now()}`);
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    vi.restoreAllMocks();
  });

  it('returns null when the state file is missing', () => {
    expect(readStuckRemediationState('agent-missing')).toBeNull();
  });

  it('returns null and logs a warning when the state file contains corrupt JSON', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const filePath = stateFile('agent-corrupt');
    mkdirSync(join(testHome, 'agents', 'agent-corrupt'), { recursive: true });
    writeFileSync(filePath, '{not-json', 'utf-8');

    expect(readStuckRemediationState('agent-corrupt')).toBeNull();
    expect(warning).toHaveBeenCalledOnce();
  });

  it('creates the parent directory and writes pretty-printed JSON', () => {
    const state: StuckRemediationState = {
      lastStage: 2,
      lastStageAt: '2026-05-23T12:00:00.000Z',
      firstStuckAt: '2026-05-23T11:15:00.000Z',
    };

    writeStuckRemediationState('agent-write', state);

    expect(JSON.parse(readFileSync(stateFile('agent-write'), 'utf-8'))).toEqual(state);
    expect(readFileSync(stateFile('agent-write'), 'utf-8')).toBe(`${JSON.stringify(state, null, 2)}\n`);
  });

  it('reads a previously written state file', () => {
    const state: StuckRemediationState = {
      lastStage: 1,
      lastStageAt: '2026-05-23T12:00:00.000Z',
      firstStuckAt: '2026-05-23T11:40:00.000Z',
    };

    writeStuckRemediationState('agent-read', state);

    expect(readStuckRemediationState('agent-read')).toEqual(state);
  });

  it('is a no-op when clearing a missing state file', () => {
    expect(() => clearStuckRemediationState('agent-missing')).not.toThrow();
  });

  it('clears an existing state file', () => {
    writeStuckRemediationState('agent-clear', {
      lastStage: 3,
      lastStageAt: '2026-05-23T12:00:00.000Z',
      firstStuckAt: '2026-05-23T10:30:00.000Z',
    });

    clearStuckRemediationState('agent-clear');

    expect(existsSync(stateFile('agent-clear'))).toBe(false);
  });
});
