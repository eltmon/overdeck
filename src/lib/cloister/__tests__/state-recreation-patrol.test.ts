import { describe, expect, it, vi } from 'vitest';
import { createRecreatedStateWarningReporter } from '../state-recreation-patrol.js';

const project = { config: { name: 'Fixture', path: '/repo' } };

describe('recreatedStateWarnings', () => {
  it('reports an observed post-migration write as an error only once per project', async () => {
    const inspect = vi.fn(async () => ({
      postMigrationWrites: ['/repo/.pan/records/pan-3594.json'],
      inertDirectories: [],
      staleFiles: [],
    }));
    const report = createRecreatedStateWarningReporter(inspect);

    await expect(report([project])).resolves.toEqual([{
      level: 'error',
      message: 'Migrated checkout legacy state: Post-migration legacy state writes (stray writer): /repo/.pan/records/pan-3594.json. Stop the writer and move the data through the state write door.',
    }]);
    await expect(report([project])).resolves.toEqual([]);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('reports inert directories and stale content as actionable warnings', async () => {
    const inspect = vi.fn(async () => ({
      postMigrationWrites: [],
      inertDirectories: ['/repo/.pan/records', '/repo/.pan/specs'],
      staleFiles: ['/repo/.pan/drafts/pan-714.md'],
    }));
    const report = createRecreatedStateWarningReporter(inspect);

    await expect(report([project])).resolves.toEqual([{
      level: 'warn',
      message: 'Migrated checkout legacy state: Inert legacy state directories (not a stray writer): /repo/.pan/records, /repo/.pan/specs. After confirming they are empty, remove them with rm -rf /repo/.pan/{records,specs}. Unmigrated legacy state content (not a stray writer): /repo/.pan/drafts/pan-714.md. Compare it with overdeck-state before deletion.',
    }]);
  });
});
