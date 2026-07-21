import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CANONICAL_STATE_PLANE_MODULE = 'src/lib/state-plane.ts';
const PATH_LIST_ANCHORS = ['.pan/records/', '.pan/review/'];

describe('state-plane path list has a single source', () => {
  it('keeps the state-plane path-list literal only in src/lib/state-plane.ts', () => {
    const srcFiles = listSourceFiles('src');

    const offenders = srcFiles.filter((file) => {
      const source = readFileSync(join(process.cwd(), file), 'utf-8');
      return PATH_LIST_ANCHORS.every((anchor) => source.includes(anchor));
    });

    expect(offenders).toEqual([CANONICAL_STATE_PLANE_MODULE]);
  });
});

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(join(process.cwd(), dir), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listSourceFiles(relativePath);
    return relativePath.endsWith('.ts') || relativePath.endsWith('.tsx') ? [relativePath] : [];
  });
}
