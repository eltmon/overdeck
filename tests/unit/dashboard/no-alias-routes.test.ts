import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const SRC_ROOT = join(process.cwd(), 'src');

const forbiddenAliasRoutes = [
  '/api/workspaces/:id/review-status',
  '/api/workspaces/:issueId/review-status',
  '/api/workspaces/:id/review-trigger',
  '/api/workspaces/:issueId/review-trigger',
  '/api/workspaces/:id/review-reset',
  '/api/workspaces/:issueId/review-reset',
  '/api/workspaces/:id/review-request',
  '/api/workspaces/:issueId/review-request',
  '/api/workspaces/:id/review',
  '/api/workspaces/:issueId/review',
  '/api/workspaces/:id/request-review',
  '/api/workspaces/:issueId/request-review',
  '/api/workspaces/:id/approve',
  '/api/workspaces/:issueId/approve',
  '/api/workspaces/:id/merge',
  '/api/workspaces/:issueId/merge',
];

async function getTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return getTypeScriptFiles(fullPath);
      }

      if (entry.isFile() && fullPath.endsWith('.ts')) {
        return [fullPath];
      }

      return [];
    }),
  );

  return files.flat();
}

describe('PAN-711 alias route regression guard', () => {
  it('does not allow deleted workspace alias routes back under src/', async () => {
    const files = await getTypeScriptFiles(SRC_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      for (const route of forbiddenAliasRoutes) {
        if (content.includes(route)) {
          violations.push(`${route} -> ${file}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
