import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migrated workspace commit gates', () => {
  it('guards spawn, both done sync sites, and legacy untrack cleanup', () => {
    const route = readFileSync(resolve('src/dashboard/server/routes/agents/spawn.ts'), 'utf8');
    const done = readFileSync(resolve('src/cli/commands/done.ts'), 'utf8');
    const spawn = readFileSync(resolve('src/lib/agents/spawn.ts'), 'utf8');
    expect(route).toContain('if (!migratedState && (existsSync(workspacePanContinuePath)');
    expect(done.match(/if \(!migratedState\) try/g)).toHaveLength(2);
    expect(spawn).toContain('Deferred legacy .pan/ index cleanup');
    expect(spawn).toContain('await isStateMigrated(project)');
  });
});
