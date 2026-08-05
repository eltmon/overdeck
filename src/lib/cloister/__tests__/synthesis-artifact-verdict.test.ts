/**
 * Fixture tests for the synthesis-artifact race guard (PAN-1577 loop).
 * Proves the orphan path honors a fresh artifact, parses every verdict
 * flavor, and never resurrects a stale one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLatestSynthesisVerdict, SYNTHESIS_ARTIFACT_FRESH_MS } from '../synthesis-verdict.js';

const NOW = Date.parse('2026-08-02T22:00:00.000Z');
let root: string;

function runDir(name: string, synthesis: string, context?: Record<string, unknown>, mtimeMs?: number): void {
  const dir = join(root, '.pan', 'review', name);
  mkdirSync(dir, { recursive: true });
  const synthesisPath = join(dir, 'synthesis.md');
  writeFileSync(synthesisPath, synthesis);
  if (context) writeFileSync(join(dir, 'context.json'), JSON.stringify(context));
  if (mtimeMs !== undefined) {
    const when = new Date(mtimeMs);
    const { utimesSync } = require('fs') as typeof import('fs');
    utimesSync(synthesisPath, when, when);
  }
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'synth-guard-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('readLatestSynthesisVerdict', () => {
  it('reads a fresh APPROVED verdict with summary and head', () => {
    runDir('agent-pan-1-review-abc123', '# Review Synthesis — PAN-1\n\n## Verdict: APPROVED\n\n## Summary\nAll four lenses pass with advisories. Ship it.\n\n## Details\n…\n', { headSha: 'abc123' });
    const verdict = readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root });
    expect(verdict?.verdict).toBe('passed');
    expect(verdict?.headSha).toBe('abc123');
    expect(verdict?.notes).toContain('All four lenses pass');
  });

  it('parses blocked (CHANGES REQUESTED) and failed flavors', () => {
    runDir('agent-pan-1-review-x', '## Verdict: CHANGES REQUESTED\n');
    expect(readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root })?.verdict).toBe('blocked');
  });

  it('picks the newest run by mtime, not by name', () => {
    runDir('agent-pan-1-review-zzz', '## Verdict: CHANGES REQUESTED\n', undefined, NOW - 10 * 60_000);
    runDir('agent-pan-1-review-aaa', '## Verdict: APPROVED\n', undefined, NOW - 5 * 60_000);
    expect(readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root })?.verdict).toBe('passed');
  });

  it('never resurrects a stale artifact (older than the freshness window)', () => {
    runDir('agent-pan-1-review-old', '## Verdict: APPROVED\n', { headSha: 'old' }, NOW - SYNTHESIS_ARTIFACT_FRESH_MS - 60_000);
    expect(readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root })).toBeNull();
  });

  it('returns null for a run without a verdict line or without synthesis', () => {
    mkdirSync(join(root, '.pan', 'review', 'empty-run'), { recursive: true });
    expect(readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root })).toBeNull();
  });
});

describe('quick-mode (self-review) artifacts — PAN-1981', () => {
  it('reads review.md with an APPROVED verdict', () => {
    runDir('agent-pan-1-review-q', '## Verdict: APPROVED\n\n## Summary\nSingle-pass review is clean.\n');
    const verdict = readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root });
    expect(verdict?.verdict).toBe('passed');
  });

  it('reads review.md with CHANGES REQUESTED as blocked, with the blocker as notes', () => {
    runDir('agent-pan-1-review-q2', '## Verdict: CHANGES REQUESTED — migration drops the events table\n\n## Details\n…\n');
    const verdict = readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root });
    expect(verdict?.verdict).toBe('blocked');
    expect(verdict?.notes).toContain('migration drops the events table');
  });

  it('reads review.md CHANGES REQUESTED with a Blocking Findings section', () => {
    runDir('agent-pan-1-review-q3', '## Verdict: CHANGES REQUESTED\n\n## Blocking Findings\n\n### Rework loop loses the durable trip\n\ndetails here\n');
    const verdict = readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root });
    expect(verdict?.verdict).toBe('blocked');
    expect(verdict?.notes).toContain('Rework loop loses the durable trip');
  });

  it('a run dir carrying ONLY review.md (no synthesis.md) is not blind to the reader', () => {
    const dir = join(root, '.pan', 'review', 'quick-only');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'review.md'), '## Verdict: FAILED\n');
    expect(readLatestSynthesisVerdict('PAN-1', { now: NOW, workspacePath: root })?.verdict).toBe('failed');
  });
});
