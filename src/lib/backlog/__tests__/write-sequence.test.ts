import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../pan-dir/auto-commit.js', () => ({ queueAutoCommit: vi.fn() }));
vi.mock('../../review-status.js', () => ({ getReviewStatusSync: vi.fn().mockReturnValue(null) }));

import { writeSequenceMd, parseSequenceMd } from '../sequence-io.js';
import { getReviewStatusSync } from '../../review-status.js';
import type { SequenceDoc } from '../types.js';

const SAMPLE_DOC: SequenceDoc = {
  version: 1,
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
    vi.mocked(getReviewStatusSync).mockReturnValue(null);
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

  it('renders an epic column with a mark only for isEpic nodes', () => {
    const doc: SequenceDoc = {
      ...SAMPLE_DOC,
      nodes: [
        { ...SAMPLE_DOC.nodes[0]!, issue: 'PAN-1', isEpic: true },
        { ...SAMPLE_DOC.nodes[1]!, issue: 'PAN-2' },
      ],
    };
    writeSequenceMd(tmpDir, doc);
    const md = readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8');

    expect(md).toContain('| rank | issue | size | importance | condition | epic | depends-on | why |');
    expect(md).toContain('| 1 | PAN-1 | M | high | ok | ✓ |  | Foundation. |');
    expect(md).toContain('| 2 | PAN-2 | S | medium | ok |  | PAN-1 | Depends on PAN-1. |');
  });

  it('preserves isEpic nodes and contains edges through the machine block', () => {
    const doc: SequenceDoc = {
      ...SAMPLE_DOC,
      nodes: [
        { ...SAMPLE_DOC.nodes[0]!, issue: 'PAN-1', isEpic: true },
        { ...SAMPLE_DOC.nodes[1]!, issue: 'PAN-2' },
      ],
      edges: [{ from: 'PAN-1', to: 'PAN-2', type: 'contains', source: 'github-ref', confidence: 1 }],
    };
    writeSequenceMd(tmpDir, doc);
    const result = parseSequenceMd(readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.nodes.find((n) => n.issue === 'PAN-1')?.isEpic).toBe(true);
      expect(result.doc.nodes.find((n) => n.issue === 'PAN-2')?.isEpic).toBeUndefined();
      expect(result.doc.edges).toEqual([{ from: 'PAN-1', to: 'PAN-2', type: 'contains', source: 'github-ref', confidence: 1 }]);
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

describe('writeSequenceMd – merge-preservation (FR-13, FR-15, FR-16, FR-17)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sequence-merge-test-'));
    vi.mocked(getReviewStatusSync).mockReturnValue(null);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function makeDoc(overrides: Partial<SequenceDoc>): SequenceDoc {
    return { ...SAMPLE_DOC, ...overrides };
  }

  it('preserves operator-set gate (ready/blocked) across re-sequence', () => {
    // Write initial doc with operator-set gates
    const initial = makeDoc({
      nodes: [
        { issue: 'PAN-1', rank: 1, size: 'S', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'First.', gate: 'blocked', planning: 'auto' },
        { issue: 'PAN-2', rank: 2, size: 'S', importance: 'medium', score: 70, condition: 'ok', dependsOn: [], why: 'Second.', gate: 'ready', planning: 'auto' },
      ],
    });
    writeSequenceMd(tmpDir, initial);

    // Re-sequence: AI resets gates back to auto
    const resequenced = makeDoc({
      nodes: [
        { issue: 'PAN-1', rank: 1, size: 'S', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'First.', gate: 'auto', planning: 'auto' },
        { issue: 'PAN-2', rank: 2, size: 'S', importance: 'medium', score: 70, condition: 'ok', dependsOn: [], why: 'Second.', gate: 'auto', planning: 'auto' },
      ],
    });
    writeSequenceMd(tmpDir, resequenced);

    const md = readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8');
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byIssue = new Map(result.doc.nodes.map((n) => [n.issue, n]));
    expect(byIssue.get('PAN-1')?.gate).toBe('blocked');
    expect(byIssue.get('PAN-2')?.gate).toBe('ready');
  });

  it('preserves operator-set planning policy across re-sequence', () => {
    const initial = makeDoc({
      nodes: [
        { issue: 'PAN-1', rank: 1, size: 'S', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'First.', gate: 'auto', planning: 'interactive' },
      ],
    });
    writeSequenceMd(tmpDir, initial);

    const resequenced = makeDoc({
      nodes: [
        { issue: 'PAN-1', rank: 1, size: 'S', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'First.', gate: 'auto', planning: 'auto' },
      ],
    });
    writeSequenceMd(tmpDir, resequenced);

    const md = readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8');
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nodes[0].planning).toBe('interactive');
  });

  it('pins in-pipeline issue rank/why/rationale when workspace dir exists', () => {
    // Create workspace dir to mark PAN-1 as in-pipeline
    mkdirSync(join(tmpDir, 'workspaces', 'feature-pan-1'), { recursive: true });

    const initial = makeDoc({
      nodes: [
        { issue: 'PAN-1', rank: 1, size: 'S', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'Original why.', gate: 'auto', planning: 'auto', rationale: 'Original rationale.' },
        { issue: 'PAN-2', rank: 2, size: 'S', importance: 'medium', score: 50, condition: 'ok', dependsOn: [], why: 'Not pinned.', gate: 'auto', planning: 'auto' },
      ],
    });
    writeSequenceMd(tmpDir, initial);

    // Re-sequence tries to change rank/why for PAN-1 (in-pipeline)
    const resequenced = makeDoc({
      nodes: [
        { issue: 'PAN-2', rank: 1, size: 'S', importance: 'medium', score: 60, condition: 'ok', dependsOn: [], why: 'Moved up.', gate: 'auto', planning: 'auto' },
        { issue: 'PAN-1', rank: 2, size: 'S', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'Changed why.', gate: 'auto', planning: 'auto', rationale: 'Changed rationale.' },
      ],
    });
    writeSequenceMd(tmpDir, resequenced);

    const md = readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8');
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pan1 = result.doc.nodes.find((n) => n.issue === 'PAN-1');
    expect(pan1?.rank).toBe(1);
    expect(pan1?.why).toBe('Original why.');
    expect(pan1?.rationale).toBe('Original rationale.');
  });

  it('preserves operator edges and drops ai-inferred duplicates replaced by re-sequence', () => {
    const initial = makeDoc({
      nodes: [{ issue: 'PAN-1', rank: 1, size: 'S', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'First.', gate: 'auto', planning: 'auto' }],
      edges: [
        { from: 'PAN-1', to: 'PAN-2', type: 'unblocks', source: 'operator', confidence: 1 },
        { from: 'PAN-2', to: 'PAN-3', type: 'informs', source: 'ai-inferred', confidence: 0.7 },
      ],
    });
    writeSequenceMd(tmpDir, initial);

    // Re-sequence provides new ai-inferred edges but no operator edge
    const resequenced = makeDoc({
      nodes: [{ issue: 'PAN-1', rank: 1, size: 'S', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'First.', gate: 'auto', planning: 'auto' }],
      edges: [
        { from: 'PAN-3', to: 'PAN-4', type: 'informs', source: 'ai-inferred', confidence: 0.5 },
      ],
    });
    writeSequenceMd(tmpDir, resequenced);

    const md = readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8');
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const operatorEdges = result.doc.edges.filter((e) => e.source === 'operator');
    expect(operatorEdges).toHaveLength(1);
    expect(operatorEdges[0].from).toBe('PAN-1');
    // New ai-inferred edge is present
    expect(result.doc.edges.some((e) => e.from === 'PAN-3')).toBe(true);
    // Old ai-inferred edge from initial is not preserved
    expect(result.doc.edges.some((e) => e.from === 'PAN-2' && e.source === 'ai-inferred')).toBe(false);
  });
});

describe('writeSequenceMd – operatorEdit mode resets gate/planning (FR-15/FR-17)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sequence-reset-test-'));
    vi.mocked(getReviewStatusSync).mockReturnValue(null);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function makeNode(issue: string, gate: 'auto' | 'ready' | 'blocked', planning: 'auto' | 'skip' | 'interactive') {
    return { issue, rank: 1, size: 'S' as const, importance: 'medium' as const, score: 50, condition: 'ok' as const, dependsOn: [], why: 'Why.', gate, planning };
  }

  function makeDoc(gate: 'auto' | 'ready' | 'blocked', planning: 'auto' | 'skip' | 'interactive'): SequenceDoc {
    return { ...SAMPLE_DOC, nodes: [makeNode('PAN-1', gate, planning)] };
  }

  it('resets blocked -> auto when operatorEdit: true', () => {
    writeSequenceMd(tmpDir, makeDoc('blocked', 'auto'));
    writeSequenceMd(tmpDir, makeDoc('auto', 'auto'), { operatorEdit: true });
    const result = parseSequenceMd(readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.nodes[0].gate).toBe('auto');
  });

  it('resets ready -> auto when operatorEdit: true', () => {
    writeSequenceMd(tmpDir, makeDoc('ready', 'auto'));
    writeSequenceMd(tmpDir, makeDoc('auto', 'auto'), { operatorEdit: true });
    const result = parseSequenceMd(readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.nodes[0].gate).toBe('auto');
  });

  it('resets interactive -> auto when operatorEdit: true', () => {
    writeSequenceMd(tmpDir, makeDoc('auto', 'interactive'));
    writeSequenceMd(tmpDir, makeDoc('auto', 'auto'), { operatorEdit: true });
    const result = parseSequenceMd(readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.nodes[0].planning).toBe('auto');
  });

  it('resets skip -> auto when operatorEdit: true', () => {
    writeSequenceMd(tmpDir, makeDoc('auto', 'skip'));
    writeSequenceMd(tmpDir, makeDoc('auto', 'auto'), { operatorEdit: true });
    const result = parseSequenceMd(readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.nodes[0].planning).toBe('auto');
  });

  it('AI re-sequence (no operatorEdit) still preserves prior non-auto gate/planning', () => {
    writeSequenceMd(tmpDir, makeDoc('blocked', 'interactive'));
    writeSequenceMd(tmpDir, makeDoc('auto', 'auto')); // no operatorEdit flag
    const result = parseSequenceMd(readFileSync(join(tmpDir, '.pan/backlog/sequence.md'), 'utf-8'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.nodes[0].gate).toBe('blocked');
      expect(result.doc.nodes[0].planning).toBe('interactive');
    }
  });
});
