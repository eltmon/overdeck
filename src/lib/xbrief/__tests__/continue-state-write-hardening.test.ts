import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  ContinueStateUnreadableError,
  continueStatePath,
  updateContinueState,
  writeContinueState,
  type ContinueState,
} from '../continue-state.js';

let TEST_DIR: string;
const issueId = 'PAN-5';

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'continue-state-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

function filePath(): string {
  return continueStatePath(TEST_DIR, issueId);
}

describe('updateContinueState write hardening (PAN-4225)', () => {
  it('ac1: throws ContinueStateUnreadableError and leaves an unparseable file untouched', () => {
    mkdirSync(join(TEST_DIR, '.pan', 'continues'), { recursive: true });
    const corrupt = '{"items": {';
    writeFileSync(filePath(), corrupt, 'utf-8');

    expect(() => updateContinueState(TEST_DIR, issueId, (s) => s)).toThrow(ContinueStateUnreadableError);
    expect(readFileSync(filePath(), 'utf-8')).toBe(corrupt);
  });

  it('ac2: writeContinueState leaves no *.tmp file behind', () => {
    const now = new Date().toISOString();
    const state: ContinueState = {
      version: '1',
      issueId,
      created: now,
      updated: now,
      gitState: {},
      decisions: [],
      hazards: [],
      resumePoint: null,
      sessionHistory: [],
    };
    writeContinueState(TEST_DIR, issueId, state);

    const files = readdirSync(join(TEST_DIR, '.pan', 'continues'));
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(existsSync(filePath())).toBe(true);
  });

  it('ac3: creates the file from emptyState when absent, with the mutation applied', () => {
    const result = updateContinueState(TEST_DIR, issueId, (state) => ({
      ...state,
      hazards: [{ id: 'H1', summary: 'new hazard' }],
    }));

    expect(result.hazards).toEqual([{ id: 'H1', summary: 'new hazard' }]);
    expect(existsSync(filePath())).toBe(true);
    const onDisk = JSON.parse(readFileSync(filePath(), 'utf-8')) as ContinueState;
    expect(onDisk.hazards).toEqual([{ id: 'H1', summary: 'new hazard' }]);
  });

  it('ac4: a feedback-appending mutation preserves every existing items entry', () => {
    updateContinueState(TEST_DIR, issueId, (state) => ({
      ...state,
      items: {
        'item-1': { status: 'completed' },
        'item-2': { status: 'in_progress', claimedBy: 'agent-x' },
      },
    }));

    const result = updateContinueState(TEST_DIR, issueId, (state) => {
      const feedback = state.feedback ?? [];
      return {
        ...state,
        feedback: [...feedback, {
          seq: 1,
          specialist: 'review-agent',
          outcome: 'changes-requested',
          timestamp: new Date().toISOString(),
          markdownBody: '# feedback',
        }],
      };
    });

    expect(result.items).toEqual({
      'item-1': { status: 'completed' },
      'item-2': { status: 'in_progress', claimedBy: 'agent-x' },
    });
    expect(result.feedback).toHaveLength(1);
  });
});
