import { describe, it, expect } from 'vitest';
import { parseSequenceJson } from '../types.js';

const VALID_NODE = {
  issue: 'PAN-1',
  rank: 1,
  size: 'M',
  importance: 'high',
  score: 80,
  condition: 'ok',
  dependsOn: [],
  why: 'Needed for the backlog system to function.',
  gate: 'auto',
  planning: 'auto',
};

const VALID_EDGE = {
  from: 'PAN-1',
  to: 'PAN-2',
  type: 'unblocks',
  source: 'ai-inferred',
  confidence: 0.9,
};

const VALID_DOC = {
  version: 1,
  project: 'overdeck',
  generatedAt: '2026-06-19T00:00:00Z',
  model: 'claude-opus-4-8',
  pass: 'creation',
  openCount: 1,
  nodes: [VALID_NODE],
  edges: [VALID_EDGE],
};

describe('parseSequenceJson', () => {
  it('accepts a well-formed document', () => {
    const result = parseSequenceJson(VALID_DOC);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.nodes[0].issue).toBe('PAN-1');
    }
  });

  it('accepts version as a number (PRD contract)', () => {
    expect(parseSequenceJson({ ...VALID_DOC, version: 1 }).ok).toBe(true);
    expect(parseSequenceJson({ ...VALID_DOC, version: 2 }).ok).toBe(true);
  });

  it('rejects version as a string', () => {
    expect(parseSequenceJson({ ...VALID_DOC, version: '1' }).ok).toBe(false);
  });

  it('rejects a node missing issue', () => {
    const doc = { ...VALID_DOC, nodes: [{ ...VALID_NODE, issue: undefined }] };
    const result = parseSequenceJson(doc);
    expect(result.ok).toBe(false);
  });

  it('rejects a node missing rank', () => {
    const doc = { ...VALID_DOC, nodes: [{ ...VALID_NODE, rank: undefined }] };
    const result = parseSequenceJson(doc);
    expect(result.ok).toBe(false);
  });

  it('rejects a node missing size', () => {
    const doc = { ...VALID_DOC, nodes: [{ ...VALID_NODE, size: undefined }] };
    const result = parseSequenceJson(doc);
    expect(result.ok).toBe(false);
  });

  it('rejects a node missing importance', () => {
    const doc = { ...VALID_DOC, nodes: [{ ...VALID_NODE, importance: undefined }] };
    const result = parseSequenceJson(doc);
    expect(result.ok).toBe(false);
  });

  it('rejects a node missing condition', () => {
    const doc = { ...VALID_DOC, nodes: [{ ...VALID_NODE, condition: undefined }] };
    const result = parseSequenceJson(doc);
    expect(result.ok).toBe(false);
  });

  it('accepts all valid size values', () => {
    for (const size of ['XS', 'S', 'M', 'L', 'XL']) {
      const result = parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, size }] });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an out-of-enum size', () => {
    const doc = { ...VALID_DOC, nodes: [{ ...VALID_NODE, size: 'XXL' }] };
    expect(parseSequenceJson(doc).ok).toBe(false);
  });

  it('accepts all valid importance values', () => {
    for (const importance of ['critical', 'high', 'medium', 'low']) {
      const result = parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, importance }] });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an out-of-enum importance', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, importance: 'urgent' }] }).ok).toBe(false);
  });

  it('accepts all valid condition values', () => {
    for (const condition of ['ok', 'needs-refinement', 'stale']) {
      const result = parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, condition }] });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an out-of-enum condition', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, condition: 'done' }] }).ok).toBe(false);
  });

  it('accepts all valid gate values', () => {
    for (const gate of ['auto', 'ready', 'blocked']) {
      const result = parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, gate }] });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an out-of-enum gate', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, gate: 'pending' }] }).ok).toBe(false);
  });

  it('accepts all valid planning values', () => {
    for (const planning of ['skip', 'auto', 'interactive']) {
      const result = parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, planning }] });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an out-of-enum planning', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, planning: 'manual' }] }).ok).toBe(false);
  });

  it('accepts all valid edge type values', () => {
    for (const type of ['unblocks', 'informs']) {
      const result = parseSequenceJson({ ...VALID_DOC, edges: [{ ...VALID_EDGE, type }] });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an out-of-enum edge type', () => {
    expect(parseSequenceJson({ ...VALID_DOC, edges: [{ ...VALID_EDGE, type: 'requires' }] }).ok).toBe(false);
  });

  it('accepts all valid edge source values', () => {
    for (const source of ['github-ref', 'operator', 'ai-inferred']) {
      const result = parseSequenceJson({ ...VALID_DOC, edges: [{ ...VALID_EDGE, source }] });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects an out-of-enum edge source', () => {
    expect(parseSequenceJson({ ...VALID_DOC, edges: [{ ...VALID_EDGE, source: 'manual' }] }).ok).toBe(false);
  });

  it('rejects score below 0', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, score: -1 }] }).ok).toBe(false);
  });

  it('rejects score above 100', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, score: 101 }] }).ok).toBe(false);
  });

  it('accepts score at boundary values 0 and 100', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, score: 0 }] }).ok).toBe(true);
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, score: 100 }] }).ok).toBe(true);
  });

  it('rejects dependsOn with non-string elements', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, dependsOn: [123] }] }).ok).toBe(false);
  });

  it('accepts dependsOn as empty array', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, dependsOn: [] }] }).ok).toBe(true);
  });

  it('accepts dependsOn as string array', () => {
    expect(parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, dependsOn: ['PAN-2', 'PAN-3'] }] }).ok).toBe(true);
  });

  it('rejects confidence below 0', () => {
    expect(parseSequenceJson({ ...VALID_DOC, edges: [{ ...VALID_EDGE, confidence: -0.1 }] }).ok).toBe(false);
  });

  it('rejects confidence above 1', () => {
    expect(parseSequenceJson({ ...VALID_DOC, edges: [{ ...VALID_EDGE, confidence: 1.1 }] }).ok).toBe(false);
  });

  it('accepts confidence at boundary values 0 and 1', () => {
    expect(parseSequenceJson({ ...VALID_DOC, edges: [{ ...VALID_EDGE, confidence: 0 }] }).ok).toBe(true);
    expect(parseSequenceJson({ ...VALID_DOC, edges: [{ ...VALID_EDGE, confidence: 1 }] }).ok).toBe(true);
  });

  it('rejects a node whose why exceeds 140 characters', () => {
    const longWhy = 'x'.repeat(141);
    const doc = { ...VALID_DOC, nodes: [{ ...VALID_NODE, why: longWhy }] };
    expect(parseSequenceJson(doc).ok).toBe(false);
  });

  it('accepts a why field of exactly 140 characters', () => {
    const why = 'x'.repeat(140);
    const result = parseSequenceJson({ ...VALID_DOC, nodes: [{ ...VALID_NODE, why }] });
    expect(result.ok).toBe(true);
  });

  it('accepts all valid pass modes', () => {
    for (const pass of ['creation', 'incremental', 'review']) {
      expect(parseSequenceJson({ ...VALID_DOC, pass }).ok).toBe(true);
    }
  });

  it('rejects an invalid pass mode', () => {
    expect(parseSequenceJson({ ...VALID_DOC, pass: 'full' }).ok).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(parseSequenceJson(null).ok).toBe(false);
    expect(parseSequenceJson('string').ok).toBe(false);
    expect(parseSequenceJson(42).ok).toBe(false);
  });
});
