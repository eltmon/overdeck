import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('PAN-2640 classify-lookups no-loss audit', () => {
  it('keeps every caller on the bulk beads-presence door', () => {
    const callers = [
      'src/cli/commands/flywheel-surfaces.ts',
      'src/lib/cloister/flywheel.ts',
      'src/dashboard/server/routes/backlog.ts',
    ];

    for (const file of callers) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source, file).toContain('buildClassifyLookups');
      expect(source, file).toContain('issuesWithBeads');
    }
  });

  it('cannot fall back to a synchronous per-workspace bd read', () => {
    const source = readFileSync(join(root, 'src/lib/backlog/lookups.ts'), 'utf8');

    expect(source).not.toContain('getBeadsForIssueSync');
    expect(source).not.toContain('createBeadsResolver');
  });
});
