import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/canonicalize-circular-deps.js', import.meta.url);

function runCanonicalizer(input: string): string {
  return execFileSync('node', [SCRIPT_SOURCE.pathname], { input, encoding: 'utf-8' }).trim();
}

describe('canonicalize-circular-deps.js', () => {
  it('collapses different rotations of the same directed cycle', () => {
    const input = JSON.stringify([
      ['./a.ts', './b.ts', './c.ts'],
      ['./b.ts', './c.ts', './a.ts'],
      ['./c.ts', './a.ts', './b.ts'],
    ]);

    const output = runCanonicalizer(input);

    expect(output.split('\n')).toEqual(['src/a.ts > src/b.ts > src/c.ts']);
  });

  it('keeps distinct directed cycles with the same member set separate', () => {
    const input = JSON.stringify([
      ['./a.ts', './b.ts', './c.ts'],
      ['./a.ts', './c.ts', './b.ts'],
    ]);

    const output = runCanonicalizer(input);

    expect(output.split('\n').sort()).toEqual([
      'src/a.ts > src/b.ts > src/c.ts',
      'src/a.ts > src/c.ts > src/b.ts',
    ]);
  });
});
