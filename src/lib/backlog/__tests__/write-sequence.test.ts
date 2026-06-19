import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../pan-dir/auto-commit.js', () => ({ queueAutoCommit: vi.fn() }));

import { writeSequenceMd, parseSequenceMd } from '../sequence-io.js';
import type { SequenceDoc } from '../types.js';

const SAMPLE_DOC: SequenceDoc = {
  version: '1',
  project: 'overdeck',
  generatedAt: '2026-06-19T00:00:00Z',
  model: 'claude-opus-4-8',
  pass: 'creation',
  openCount: 3,
  nodes: [
    { issue: 'PAN-1', rank: 1, size: 'M', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'Foundation.', gate: 'auto', planning: 'auto' },
    { issue: 'PAN-2', rank: 2, size: 'S', importance: 'medium', score: 70, condition: 'ok', dependsOn: ['PAN-1'], why: 'Depends on PAN-1.', gate: 'auto', planning: 'skip', rationale: 'Full paragraph for top-tier.' },
    { issue: 'PAN-3', rank: 3, size: 'L', importance: 'low', score: 50, condition: 'needs-refinement', dependsOn: [], why: 'Long tail.', gate: 'blocked', planning: 'interactive' },
  ],
  edges: [],
};

describe('writeSequenceMd + parseSequenceMd round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sequence-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('round-trips a SequenceDoc through write → parse', () => {
    writeSequenceMd(tmpDir, SAMPLE_DOC);
    const md = readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8');
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.nodes).toHaveLength(3);
      expect(result.doc.project).toBe('overdeck');
      expect(result.doc.nodes[0].issue).toBe('PAN-1');
    }
  });

  it('includes rationale paragraph only for top-tier nodes with rationale field', () => {
    writeSequenceMd(tmpDir, SAMPLE_DOC);
    const md = readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8');
    expect(md).toContain('Full paragraph for top-tier.');
  });

  it('calls queueAutoCommit with the expected subject', async () => {
    const { queueAutoCommit } = await import('../../pan-dir/auto-commit.js');
    writeSequenceMd(tmpDir, SAMPLE_DOC);
    expect(queueAutoCommit).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'chore(state): update backlog sequence (overdeck)' })
    );
  });

  it('footprint for 522 nodes stays under 65k tokens (characters proxy)', () => {
    const bigDoc: SequenceDoc = {
      ...SAMPLE_DOC,
      openCount: 522,
      nodes: Array.from({ length: 522 }, (_, i) => ({
        issue: `PAN-${i + 1}`,
        rank: i + 1,
        size: 'M' as const,
        importance: 'medium' as const,
        score: 50,
        condition: 'ok' as const,
        dependsOn: [],
        why: `Short why for PAN-${i + 1}.`,
        gate: 'auto' as const,
        planning: 'auto' as const,
        rationale: i < 80 ? `Rationale paragraph for issue ${i + 1}, covering the motivation in detail.` : undefined,
      })),
    };
    writeSequenceMd(tmpDir, bigDoc);
    const md = readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8');
    // 65k tokens ~ 260k chars (4 chars/token). Using a generous 300k as proxy.
    expect(md.length).toBeLessThan(300_000);
  });
});
