import { describe, expect, it } from 'vitest';
import { formatWorkspaceRelativePath } from './filePathDisplay';

describe('formatWorkspaceRelativePath', () => {
  it('keeps the workspace basename when formatting a path inside the workspace', () => {
    expect(
      formatWorkspaceRelativePath(
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370/src/dashboard/frontend/src/App.tsx',
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370',
      ),
    ).toBe('feature-pan-1370/src/dashboard/frontend/src/App.tsx');
  });

  it('formats the workspace root as the workspace basename', () => {
    expect(
      formatWorkspaceRelativePath(
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370',
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370',
      ),
    ).toBe('feature-pan-1370');
  });

  it('leaves absolute paths outside the workspace unchanged', () => {
    expect(
      formatWorkspaceRelativePath(
        '/tmp/other-project/src/index.ts',
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370',
      ),
    ).toBe('/tmp/other-project/src/index.ts');
  });

  it('ignores trailing separators on the workspace root', () => {
    expect(
      formatWorkspaceRelativePath(
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370/src/index.ts',
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370/',
      ),
    ).toBe('feature-pan-1370/src/index.ts');
  });

  it('preserves line and column suffixes', () => {
    expect(
      formatWorkspaceRelativePath(
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370/src/index.ts:12:5',
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370',
      ),
    ).toBe('feature-pan-1370/src/index.ts:12:5');
  });

  it('prefixes relative paths with the workspace basename', () => {
    expect(
      formatWorkspaceRelativePath(
        './src/index.ts:9',
        '/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1370',
      ),
    ).toBe('feature-pan-1370/src/index.ts:9');
  });

  it('normalizes Windows drive paths case-insensitively', () => {
    expect(
      formatWorkspaceRelativePath(
        'C:\\Users\\eltmon\\Projects\\feature-pan-1370\\src\\index.ts:8',
        'c:\\users\\eltmon\\projects\\feature-pan-1370',
      ),
    ).toBe('feature-pan-1370/src/index.ts:8');
  });
});
