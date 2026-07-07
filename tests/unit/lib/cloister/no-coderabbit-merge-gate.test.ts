/**
 * Structural guard: CodeRabbit state must never reach merge gates (PAN-2374).
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const GATE_FILES = [
  'src/lib/review-status.ts',
  'src/lib/cloister/verification-runner.ts',
  'src/lib/cloister/deacon-merge.ts',
  'src/lib/cloister/auto-merge-eligibility.ts',
  'src/lib/flywheel-merge-order.ts',
];

const INGESTION_FILE = 'src/lib/cloister/coderabbit-ingestion.ts';

async function readSource(relPath: string): Promise<string> {
  const content = await readFile(join(process.cwd(), relPath), 'utf-8');
  return content.toLowerCase();
}

describe('no-coderabbit-merge-gate guard', () => {
  for (const file of GATE_FILES) {
    it(`does not allow 'coderabbit' in ${file}`, async () => {
      const lower = await readSource(file);
      expect(lower).not.toContain('coderabbit');
    });
  }

  it('does not allow merge-gate vocabulary in coderabbit-ingestion.ts', async () => {
    const lower = await readSource(INGESTION_FILE);
    expect(lower).not.toContain('setreviewstatus');
    expect(lower).not.toContain('blockerreasons');
    expect(lower).not.toContain('readyformerge');
  });
});
