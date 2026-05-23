import { describe, expect, it } from 'vitest';
import { resolveMarkdownFileLinkMeta } from './markdown-links';

const cwd = '/home/eltmon/project';

describe('resolveMarkdownFileLinkMeta', () => {
  it('resolves an absolute path with line and column', () => {
    expect(resolveMarkdownFileLinkMeta('/home/eltmon/project/src/App.tsx:12:5', cwd)).toEqual({
      filePath: '/home/eltmon/project/src/App.tsx',
      targetPath: '/home/eltmon/project/src/App.tsx:12:5',
      displayPath: 'project/src/App.tsx:12:5',
      basename: 'App.tsx',
      line: 12,
      column: 5,
    });
  });

  it('resolves an absolute path with only a line', () => {
    expect(resolveMarkdownFileLinkMeta('/home/eltmon/project/src/App.tsx:12', cwd)).toEqual({
      filePath: '/home/eltmon/project/src/App.tsx',
      targetPath: '/home/eltmon/project/src/App.tsx:12',
      displayPath: 'project/src/App.tsx:12',
      basename: 'App.tsx',
      line: 12,
    });
  });

  it('resolves a bare absolute path', () => {
    expect(resolveMarkdownFileLinkMeta('/home/eltmon/project/src/App.tsx', cwd)).toEqual({
      filePath: '/home/eltmon/project/src/App.tsx',
      targetPath: '/home/eltmon/project/src/App.tsx',
      displayPath: 'project/src/App.tsx',
      basename: 'App.tsx',
    });
  });

  it('resolves a workspace-relative path', () => {
    expect(resolveMarkdownFileLinkMeta('src/App.tsx:7:3', cwd)).toEqual({
      filePath: '/home/eltmon/project/src/App.tsx',
      targetPath: '/home/eltmon/project/src/App.tsx:7:3',
      displayPath: 'project/src/App.tsx:7:3',
      basename: 'App.tsx',
      line: 7,
      column: 3,
    });
  });

  it('resolves a parent-relative path with upstream join semantics', () => {
    expect(resolveMarkdownFileLinkMeta('../shared/util.ts:4', cwd)).toEqual({
      filePath: '/home/eltmon/project/../shared/util.ts',
      targetPath: '/home/eltmon/project/../shared/util.ts:4',
      displayPath: 'project/../shared/util.ts:4',
      basename: 'util.ts',
      line: 4,
    });
  });

  it.each(['https://example.com/file.ts', 'mailto:user@example.com', '#anchor'])(
    'returns null for non-file href %s',
    (href) => {
      expect(resolveMarkdownFileLinkMeta(href, cwd)).toBeNull();
    },
  );

  it('returns null when cwd is empty for relative paths', () => {
    expect(resolveMarkdownFileLinkMeta('src/App.tsx', '')).toBeNull();
    expect(resolveMarkdownFileLinkMeta('src/App.tsx', undefined)).toBeNull();
  });

  it('resolves Windows absolute paths', () => {
    expect(
      resolveMarkdownFileLinkMeta(
        'C:\\Users\\eltmon\\project\\src\\App.tsx:8:2',
        'C:\\Users\\eltmon\\project',
      ),
    ).toEqual({
      filePath: 'C:\\Users\\eltmon\\project\\src\\App.tsx',
      targetPath: 'C:\\Users\\eltmon\\project\\src\\App.tsx:8:2',
      displayPath: 'project/src/App.tsx:8:2',
      basename: 'App.tsx',
      line: 8,
      column: 2,
    });
  });
});
