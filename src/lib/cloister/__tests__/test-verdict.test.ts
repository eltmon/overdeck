import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  clearTestVerdictArtifact,
  decideUnsignaledTestAction,
  readTestVerdictArtifact,
  testVerdictArtifactPath,
} from '../test-verdict.js';

describe('test-verdict artifact (PAN-1681)', () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'pan-1681-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  function writeArtifact(obj: unknown): void {
    const p = testVerdictArtifactPath(ws);
    mkdirSync(join(ws, '.pan', 'test'), { recursive: true });
    writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  }

  describe('repository tracking guard (PAN-2325)', () => {
    it('keeps the deterministic verdict artifact ignored and untracked', () => {
      const ignored = execFileSync('git', ['check-ignore', '.pan/test/result.json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim();
      const tracked = execFileSync('git', ['ls-files', '.pan/test/result.json'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim();

      expect(ignored).toBe('.pan/test/result.json');
      expect(tracked).toBe('');
    });
  });

  describe('readTestVerdictArtifact', () => {
    it('returns null when the file is absent', () => {
      expect(readTestVerdictArtifact(ws)).toBeNull();
    });

    it('reads a passed verdict with notes', () => {
      writeArtifact({ status: 'passed', notes: 'all 6 gates green' });
      expect(readTestVerdictArtifact(ws)).toEqual({ status: 'passed', notes: 'all 6 gates green' });
    });

    it('recovers a workspace verdict artifact even though .pan/test is gitignored (PAN-2325)', () => {
      writeArtifact({ status: 'passed', notes: 'workspace-local recovery survives ignore rule' });
      expect(readTestVerdictArtifact(ws)).toEqual({
        status: 'passed',
        notes: 'workspace-local recovery survives ignore rule',
      });
    });

    it('reads a failed verdict', () => {
      writeArtifact({ status: 'failed', notes: '3 tests failing' });
      expect(readTestVerdictArtifact(ws)).toEqual({ status: 'failed', notes: '3 tests failing' });
    });

    it('returns null on malformed JSON', () => {
      writeArtifact('{ not json');
      expect(readTestVerdictArtifact(ws)).toBeNull();
    });

    it('returns null on an unknown status (never fabricated)', () => {
      writeArtifact({ status: 'maybe', notes: 'unsure' });
      expect(readTestVerdictArtifact(ws)).toBeNull();
    });

    it('drops a non-string notes field', () => {
      writeArtifact({ status: 'passed', notes: 42 });
      expect(readTestVerdictArtifact(ws)).toEqual({ status: 'passed', notes: undefined });
    });

    it('rejects an artifact older than the current dispatch (H3 stale guard)', () => {
      writeArtifact({ status: 'passed' });
      const p = testVerdictArtifactPath(ws);
      const tenMinAgoSec = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
      utimesSync(p, tenMinAgoSec, tenMinAgoSec);
      // Dispatch happened 5 min ago — the artifact predates it, so it's stale.
      expect(readTestVerdictArtifact(ws, Date.now() - 5 * 60 * 1000)).toBeNull();
      // Without a floor, the same artifact is honored.
      expect(readTestVerdictArtifact(ws)).toEqual({ status: 'passed', notes: undefined });
    });
  });

  describe('clearTestVerdictArtifact', () => {
    it('removes an existing artifact and is a no-op when absent', () => {
      writeArtifact({ status: 'passed' });
      expect(existsSync(testVerdictArtifactPath(ws))).toBe(true);
      clearTestVerdictArtifact(ws);
      expect(existsSync(testVerdictArtifactPath(ws))).toBe(false);
      // Idempotent — clearing again does not throw.
      expect(() => clearTestVerdictArtifact(ws)).not.toThrow();
    });
  });

  describe('decideUnsignaledTestAction', () => {
    const passed = { status: 'passed' as const, notes: 'ok' };
    const failed = { status: 'failed' as const, notes: 'boom' };

    it('dead session + artifact → auto-complete from the artifact', () => {
      expect(decideUnsignaledTestAction({ sessionLive: false, idle: false, alreadyNudged: false, artifact: passed }))
        .toEqual({ action: 'auto-complete', status: 'passed', notes: 'ok' });
      expect(decideUnsignaledTestAction({ sessionLive: false, idle: false, alreadyNudged: false, artifact: failed }))
        .toEqual({ action: 'auto-complete', status: 'failed', notes: 'boom' });
    });

    it('dead session + no artifact → none (never guesses pass/fail)', () => {
      expect(decideUnsignaledTestAction({ sessionLive: false, idle: false, alreadyNudged: false, artifact: null }))
        .toEqual({ action: 'none' });
    });

    it('alive but not idle → wait', () => {
      expect(decideUnsignaledTestAction({ sessionLive: true, idle: false, alreadyNudged: false, artifact: passed }))
        .toEqual({ action: 'wait' });
    });

    it('alive + idle + artifact + not yet nudged → nudge-verdict', () => {
      expect(decideUnsignaledTestAction({ sessionLive: true, idle: true, alreadyNudged: false, artifact: passed }))
        .toEqual({ action: 'nudge-verdict', status: 'passed', notes: 'ok' });
    });

    it('alive + idle + artifact + already nudged → auto-complete', () => {
      expect(decideUnsignaledTestAction({ sessionLive: true, idle: true, alreadyNudged: true, artifact: failed }))
        .toEqual({ action: 'auto-complete', status: 'failed', notes: 'boom' });
    });

    it('alive + idle + no artifact + not yet nudged → nudge-write', () => {
      expect(decideUnsignaledTestAction({ sessionLive: true, idle: true, alreadyNudged: false, artifact: null }))
        .toEqual({ action: 'nudge-write' });
    });

    it('alive + idle + no artifact + already nudged → escalate (PAN-3092, never guesses)', () => {
      // MIN-858 sat here for six hours: a live agent holding a finished verdict
      // in its pane only, with `none` making the deacon go quiet forever.
      expect(decideUnsignaledTestAction({ sessionLive: true, idle: true, alreadyNudged: true, artifact: null }))
        .toEqual({ action: 'escalate' });
    });
  });
});
