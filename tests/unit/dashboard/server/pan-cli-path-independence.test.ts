import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const dashboardServerRoot = join(process.cwd(), 'src', 'dashboard', 'server');
const dashboardPanCallers = [
  'routes/agents/shared.ts',
  'routes/context.ts',
  'routes/issues.ts',
  'routes/misc/meta.ts',
  'routes/workspaces.ts',
] as const;

describe('dashboard pan CLI invocation audit', () => {
  it('does not rely on a pan executable being present on PATH', async () => {
    for (const relativePath of dashboardPanCallers) {
      const source = await readFile(join(dashboardServerRoot, relativePath), 'utf8');
      expect(source, relativePath).not.toMatch(/(?:execFileAsync|spawn)\(\s*['"]pan['"]/);
    }
  });
});
