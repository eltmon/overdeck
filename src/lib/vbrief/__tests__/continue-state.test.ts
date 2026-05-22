import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  appendSessionEntrySync,
  continueFilePath,
  continueFilename,
  readContinueStateSync,
  writeContinueStateSync,
  type ContinueState,
} from '../continue-state.js';

let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'continue-state-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

function freshState(issueId: string): ContinueState {
  return {
    version: '1',
    issueId,
    created: '2026-05-03T00:00:00.000Z',
    updated: '2026-05-03T00:00:00.000Z',
    gitState: { branch: 'feature/pan-946', sha: 'abc123', dirty: false },
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    agentModel: 'claude-opus-4-7',
    sessionHistory: [],
  };
}

describe('continueFilename / continueFilePath', () => {
  it('builds canonical filename', () => {
    expect(continueFilename('PAN-946')).toBe('pan-946.vbrief.json');
  });
  it('joins with projectRoot for path', () => {
    expect(continueFilePath('/tmp/proj', 'PAN-946')).toBe(
      '/tmp/proj/.pan/continues/pan-946.vbrief.json',
    );
  });
});

describe('writeContinueState / readContinueState', () => {
  it('round-trips a state document', () => {
    writeContinueStateSync(TEST_DIR, 'PAN-946', freshState('PAN-946'));
    const read = readContinueStateSync(TEST_DIR, 'PAN-946');
    expect(read?.issueId).toBe('PAN-946');
    expect(read?.gitState.branch).toBe('feature/pan-946');
    expect(read?.version).toBe('1');
  });

  it('writes atomically via .tmp + rename (no partial file left behind)', () => {
    writeContinueStateSync(TEST_DIR, 'PAN-946', freshState('PAN-946'));
    expect(existsSync(continueFilePath(TEST_DIR, 'PAN-946'))).toBe(true);
    expect(existsSync(continueFilePath(TEST_DIR, 'PAN-946') + '.tmp')).toBe(false);
  });

  it('updates the `updated` timestamp on every write', async () => {
    const state = freshState('PAN-946');
    writeContinueStateSync(TEST_DIR, 'PAN-946', state);
    const first = readContinueStateSync(TEST_DIR, 'PAN-946')!;
    await new Promise(r => setTimeout(r, 5));
    writeContinueStateSync(TEST_DIR, 'PAN-946', { ...first });
    const second = readContinueStateSync(TEST_DIR, 'PAN-946')!;
    expect(new Date(second.updated).getTime()).toBeGreaterThan(new Date(first.updated).getTime());
  });

  it('preserves `created` across writes', () => {
    const state = freshState('PAN-946');
    writeContinueStateSync(TEST_DIR, 'PAN-946', state);
    const first = readContinueStateSync(TEST_DIR, 'PAN-946')!;
    writeContinueStateSync(TEST_DIR, 'PAN-946', { ...first, decisions: [{ id: 'D1', summary: 'pick A', recordedAt: '2026-05-03T01:00:00Z' }] });
    const second = readContinueStateSync(TEST_DIR, 'PAN-946')!;
    expect(second.created).toBe(first.created);
  });

  it('returns null when file is missing', () => {
    expect(readContinueStateSync(TEST_DIR, 'PAN-999')).toBeNull();
  });

  it('throws on corrupt JSON', () => {
    const path = continueFilePath(TEST_DIR, 'PAN-946');
    mkdirSync(join(TEST_DIR, '.pan', 'continues'), { recursive: true });
    writeFileSync(path, '{not valid', 'utf-8');
    expect(() => readContinueStateSync(TEST_DIR, 'PAN-946')).toThrow();
  });

  it('throws on malformed schema', () => {
    const path = continueFilePath(TEST_DIR, 'PAN-946');
    mkdirSync(join(TEST_DIR, '.pan', 'continues'), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: '999', issueId: 'PAN-946' }), 'utf-8');
    expect(() => readContinueStateSync(TEST_DIR, 'PAN-946')).toThrow();
  });
});

describe('appendSessionEntry', () => {
  it('creates fresh state if file does not exist', () => {
    const next = appendSessionEntrySync(TEST_DIR, 'PAN-946', {
      reason: 'planning',
      agentModel: 'claude-opus-4-7',
      note: 'planning started',
    });
    expect(next.sessionHistory).toHaveLength(1);
    expect(next.sessionHistory[0].reason).toBe('planning');
    expect(next.sessionHistory[0].timestamp).toBeTruthy();
    expect(next.issueId).toBe('PAN-946');
  });

  it('appends to existing state', () => {
    writeContinueStateSync(TEST_DIR, 'PAN-946', freshState('PAN-946'));
    appendSessionEntrySync(TEST_DIR, 'PAN-946', { reason: 'start', agentModel: 'claude-opus-4-7' });
    appendSessionEntrySync(TEST_DIR, 'PAN-946', { reason: 'end' });
    const read = readContinueStateSync(TEST_DIR, 'PAN-946')!;
    expect(read.sessionHistory).toHaveLength(2);
    expect(read.sessionHistory[0].reason).toBe('start');
    expect(read.sessionHistory[1].reason).toBe('end');
  });

  it('records crash info when provided', () => {
    appendSessionEntrySync(TEST_DIR, 'PAN-946', {
      reason: 'crash-recovery',
      crashInfo: { detectedAt: '2026-05-03T01:00:00Z', description: 'tmux session died' },
    });
    const read = readContinueStateSync(TEST_DIR, 'PAN-946')!;
    expect(read.sessionHistory[0].crashInfo?.description).toBe('tmux session died');
  });

  it('accepts caller-supplied timestamp', () => {
    appendSessionEntrySync(TEST_DIR, 'PAN-946', {
      reason: 'manual',
      timestamp: '2026-05-03T05:00:00.000Z',
    });
    const read = readContinueStateSync(TEST_DIR, 'PAN-946')!;
    expect(read.sessionHistory[0].timestamp).toBe('2026-05-03T05:00:00.000Z');
  });
});
