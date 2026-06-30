import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseDispatchTier } from '../../../../src/lib/agents/dispatch-tier.js';
import type { VBriefItem } from '../../../../src/lib/vbrief/types.js';

function item(metadata: VBriefItem['metadata']): Pick<VBriefItem, 'metadata'> {
  return { metadata };
}

describe('chooseDispatchTier', () => {
  it('keeps low-difficulty high-confidence non-distributed work in context', () => {
    expect(chooseDispatchTier(item({
      difficulty: 'simple',
      files_scope: ['src/lib/foo.ts'],
      files_scope_confidence: 'high',
      readiness: 'sequential',
    }))).toBe('in-context');
  });

  it('sends complex and expert work to registered slots', () => {
    for (const difficulty of ['complex', 'expert'] as const) {
      expect(chooseDispatchTier(item({
        difficulty,
        files_scope: ['src/lib/foo.ts'],
        files_scope_confidence: 'high',
        readiness: 'ready',
      }))).toBe('registered-slot');
    }
  });

  it('sends independently dispatchable medium work to registered slots', () => {
    expect(chooseDispatchTier(item({
      difficulty: 'medium',
      files_scope: ['src/lib/foo.ts'],
      files_scope_confidence: 'high',
      readiness: 'ready',
    }))).toBe('registered-slot');
  });

  it('is deterministic for identical metadata', () => {
    const candidate = item({
      difficulty: 'medium',
      files_scope: ['src/lib/foo.ts'],
      files_scope_confidence: 'high',
      readiness: 'ready',
    });

    expect(Array.from({ length: 5 }, () => chooseDispatchTier(candidate))).toEqual([
      'registered-slot',
      'registered-slot',
      'registered-slot',
      'registered-slot',
      'registered-slot',
    ]);
  });

  it('does not contain issue-id special cases', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/agents/dispatch-tier.ts'), 'utf8');

    expect(source).not.toMatch(/PAN-\d+/);
    expect(source).not.toMatch(/issueId|issue_id|issueLabel/);
  });
});
