import { describe, expect, it } from 'vitest';
import { analyzeSwarmReadiness } from '../../../src/lib/vbrief/swarm-readiness.js';
import { formatReadinessReport } from '../../../src/cli/commands/plan-finalize.js';
import type { VBriefDocument } from '../../../src/lib/vbrief/types.js';

function makeDoc(): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'PAN-1762',
      title: 'Readiness report',
      status: 'active',
      items: [
        {
          id: 'a',
          title: 'A',
          status: 'pending',
          metadata: {
            files_scope: ['src/a.ts'],
            files_scope_confidence: 'high',
            readiness: 'ready',
            verify_commands: ['npm test'],
            expected_outputs: ['tests pass'],
          },
        },
        {
          id: 'b',
          title: 'B',
          status: 'pending',
          metadata: {
            files_scope: ['src/a.ts'],
            files_scope_confidence: 'high',
            readiness: 'ready',
            verify_commands: ['npm test'],
            expected_outputs: ['tests pass'],
          },
        },
        {
          id: 'c',
          title: 'C',
          status: 'pending',
          metadata: {
            files_scope: ['src/c.ts'],
            files_scope_confidence: 'high',
            readiness: 'ready',
            verify_commands: ['npm test'],
            expected_outputs: ['tests pass'],
          },
        },
      ],
      edges: [{ from: 'a', to: 'c', type: 'blocks' }],
    },
  };
}

describe('formatReadinessReport', () => {
  it('renders dependency waves, overlap matrix, and conflict groups', () => {
    const lines = formatReadinessReport(analyzeSwarmReadiness(makeDoc()));

    expect(lines).toContain('Readiness report:');
    expect(lines).toContain('    wave 0: a, b');
    expect(lines).toContain('    wave 1: c');
    expect(lines).toContain('    a <-> b: src/a.ts');
    expect(lines).toContain('    a + b (file_overlap) - src/a.ts');
  });

  it('renders empty overlap and conflict sections without implying failure', () => {
    const doc = makeDoc();
    doc.plan.items[1]!.metadata!.files_scope = ['src/b.ts'];

    const lines = formatReadinessReport(analyzeSwarmReadiness(doc));

    expect(lines).toContain('    no cross-item file overlaps');
    expect(lines).toContain('    none');
  });
});
