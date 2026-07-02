import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { analyzeSwarmReadiness, computeIssueFootprint, resolveIssueFootprint } from '../../../../src/lib/vbrief/swarm-readiness.js';
import { buildPanSpecFilename } from '../../../../src/lib/pan-dir/specs.js';
import type { FilesScopeConfidence, ItemReadiness, VBriefDocument, VBriefItemStatus } from '../../../../src/lib/vbrief/types.js';

function makeDoc(
  items: Array<{
    id: string;
    status?: VBriefItemStatus;
    files_scope?: string[];
    files_scope_confidence?: FilesScopeConfidence;
    readiness?: ItemReadiness;
    verify_commands?: string[];
    expected_outputs?: string[];
  }>,
  edges: Array<{ from: string; to: string; type?: 'blocks' | 'informs' }> = [],
): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test Plan',
      status: 'active',
      items: items.map(item => ({
        id: item.id,
        title: item.id,
        status: item.status ?? 'pending',
        metadata: {
          files_scope: item.files_scope,
          files_scope_confidence: item.files_scope_confidence,
          readiness: item.readiness,
          verify_commands: item.verify_commands,
          expected_outputs: item.expected_outputs,
        },
      })),
      edges: edges.map(edge => ({ from: edge.from, to: edge.to, type: edge.type ?? 'blocks' })),
    },
  };
}

function readyItem(id: string, files_scope: string[]) {
  return {
    id,
    files_scope,
    files_scope_confidence: 'high' as const,
    readiness: 'ready' as const,
    verify_commands: ['npm test'],
    expected_outputs: ['tests pass'],
  };
}

describe('analyzeSwarmReadiness', () => {
  it('returns plan waves, overlap matrix, conflict groups, and swarm eligibility', () => {
    const doc = makeDoc(
      [
        readyItem('a', ['src/a.ts']),
        readyItem('b', ['src/b.ts']),
        readyItem('c', ['src/c.ts']),
      ],
      [{ from: 'a', to: 'c' }],
    );

    const verdict = analyzeSwarmReadiness(doc);

    expect(verdict.waves.map(wave => wave.items.map(item => item.id))).toEqual([['a', 'b'], ['c']]);
    expect(verdict.overlapMatrix).toEqual({ a: {}, b: {}, c: {} });
    expect(verdict.conflictGroups).toEqual([]);
    expect(verdict.swarmEligible).toBe(true);
    expect(verdict.items.find(item => item.id === 'a')).toMatchObject({
      readiness: 'ready',
      slotEligible: true,
      missingScope: false,
      scopeConfidence: 'high',
    });
  });

  it('marks overlapping file scopes and lists shared files', () => {
    const doc = makeDoc([
      readyItem('a', ['src/lib/agents.ts']),
      readyItem('b', ['src/lib/**']),
    ]);

    const verdict = analyzeSwarmReadiness(doc);

    expect(verdict.overlapMatrix.a.b).toEqual(['src/lib/agents.ts']);
    expect(verdict.overlapMatrix.b.a).toEqual(['src/lib/agents.ts']);
    expect(verdict.conflictGroups).toEqual([
      { itemIds: ['a', 'b'], sharedFiles: ['src/lib/agents.ts'], reason: 'file_overlap' },
    ]);
    expect(verdict.items.find(item => item.id === 'a')?.overlaps).toEqual([
      { itemId: 'b', sharedFiles: ['src/lib/agents.ts'] },
    ]);
  });

  it('ignores overlaps made only of hotspot files', () => {
    const doc = makeDoc([
      readyItem('a', ['package-lock.json']),
      readyItem('b', ['package-lock.json']),
    ]);

    const verdict = analyzeSwarmReadiness(doc, { hotspots: ['package-lock.json'] });

    expect(verdict.overlapMatrix).toEqual({ a: {}, b: {} });
    expect(verdict.conflictGroups).toEqual([]);
    expect(verdict.items.flatMap(item => item.overlaps)).toEqual([]);
  });

  it('treats low-confidence scope as overlapping with all items without blocking the item', () => {
    const doc = makeDoc([
      {
        ...readyItem('a', ['src/a.ts']),
        files_scope_confidence: 'low',
      },
      readyItem('b', ['src/b.ts']),
      readyItem('c', ['src/c.ts']),
    ]);

    const verdict = analyzeSwarmReadiness(doc);
    const lowConfidenceItem = verdict.items.find(item => item.id === 'a');

    expect(lowConfidenceItem).toMatchObject({
      id: 'a',
      slotEligible: false,
      scopeConfidence: 'low',
      missingScope: false,
    });
    expect(lowConfidenceItem?.overlaps.map(overlap => overlap.itemId)).toEqual(['b', 'c']);
    expect(verdict.conflictGroups).toEqual([
      { itemIds: ['a', 'b'], sharedFiles: [], reason: 'low_confidence' },
      { itemIds: ['a', 'c'], sharedFiles: [], reason: 'low_confidence' },
    ]);
  });
});

describe('computeIssueFootprint', () => {
  it('returns the deduped union of all item file scopes', () => {
    const doc = makeDoc([
      readyItem('a', ['src/a.ts', 'src/shared.ts']),
      readyItem('b', ['src/shared.ts', 'src/b.ts']),
    ]);

    expect(computeIssueFootprint(doc)).toEqual(['src/a.ts', 'src/b.ts', 'src/shared.ts']);
  });

  it('returns an empty array when no item declares file scope', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }]);

    expect(computeIssueFootprint(doc)).toEqual([]);
  });

  it('resolves an issue spec via findSpecByIssue and returns its footprint', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pan-footprint-test-'));
    try {
      const specsDir = join(projectRoot, '.pan', 'specs');
      mkdirSync(specsDir, { recursive: true });
      const doc = {
        ...makeDoc([
          readyItem('a', ['src/a.ts']),
          readyItem('b', ['src/b.ts']),
        ]),
        status: 'active',
      };
      writeFileSync(
        join(specsDir, buildPanSpecFilename('PAN-1762', 'footprint-test', '2026-06-30')),
        JSON.stringify(doc, null, 2),
      );

      await expect(Effect.runPromise(resolveIssueFootprint(projectRoot, 'PAN-1762'))).resolves.toEqual([
        'src/a.ts',
        'src/b.ts',
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
