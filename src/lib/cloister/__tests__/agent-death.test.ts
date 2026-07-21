import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mocks = vi.hoisted(() => ({
  getOverdeckHome: vi.fn(),
  sessionExistsSync: vi.fn(),
  listPaneValuesSync: vi.fn(),
}));

vi.mock('../../paths.js', () => ({ getOverdeckHome: mocks.getOverdeckHome }));
vi.mock('../../tmux.js', () => ({
  sessionExistsSync: mocks.sessionExistsSync,
  listPaneValuesSync: mocks.listPaneValuesSync,
}));

import { describeAgentDeath, readAgentExitStatus } from '../agent-death.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agent-death-'));
  mocks.getOverdeckHome.mockReturnValue(home);
  mocks.sessionExistsSync.mockReturnValue(false);
  mocks.listPaneValuesSync.mockReturnValue([]);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function agentDir(id: string): string {
  const d = join(home, 'agents', id);
  mkdirSync(d, { recursive: true });
  return d;
}

describe('agent-death (PAN-2108)', () => {
  it('reads exit code + timestamp from the exit-status file', () => {
    const d = agentDir('agent-x');
    writeFileSync(join(d, 'exit-status'), '137 2026-06-27T18:00:00Z\n');
    expect(readAgentExitStatus('agent-x')).toEqual({ code: '137', at: '2026-06-27T18:00:00Z' });
    expect(describeAgentDeath('agent-x')).toContain('exit=137 at 2026-06-27T18:00:00Z');
  });

  it('appends the tail of output.log', () => {
    const d = agentDir('agent-y');
    writeFileSync(join(d, 'exit-status'), '1 2026-06-27T18:00:00Z\n');
    writeFileSync(join(d, 'output.log'), 'line1\nFATAL: boom\n');
    expect(describeAgentDeath('agent-y')).toContain('FATAL: boom');
  });

  it('falls back to tmux pane_exit_status when exit-status is absent but the dead pane survives', () => {
    agentDir('agent-z');
    mocks.sessionExistsSync.mockReturnValue(true);
    mocks.listPaneValuesSync.mockReturnValue(['143']);
    expect(describeAgentDeath('agent-z')).toContain('pane_exit=143');
  });

  it('reports no trace when nothing is available', () => {
    agentDir('agent-empty');
    expect(describeAgentDeath('agent-empty')).toContain('no exit trace');
  });
});
