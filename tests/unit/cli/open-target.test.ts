import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseOpenTarget } from '../../../src/cli/commands/open-target.js';

let dir: string;
let home: string;
const noIssue = { resolveIssue: () => null };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'open-target-'));
  home = join(dir, 'home');
  mkdirSync(join(home, 'x'), { recursive: true });
  writeFileSync(join(dir, 'f.ts'), '');
  writeFileSync(join(dir, 'a:1'), '');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseOpenTarget', () => {
  it('returns an existing relative file as an absolute path', () => {
    expect(parseOpenTarget('f.ts', dir, home, noIssue)).toEqual({ kind: 'path', abs: join(dir, 'f.ts') });
  });

  it('reads a line, or a line and column, after an existing file', () => {
    expect(parseOpenTarget('f.ts:12', dir, home, noIssue)).toEqual({ kind: 'path', abs: join(dir, 'f.ts'), line: 12 });
    expect(parseOpenTarget('f.ts:12:3', dir, home, noIssue)).toEqual({ kind: 'path', abs: join(dir, 'f.ts'), line: 12, column: 3 });
  });

  it('is invalid for a missing file with a position', () => {
    expect(parseOpenTarget('missing.ts:12', dir, home, noIssue)).toEqual({ kind: 'invalid' });
  });

  it('returns an issue for an id that is not a file', () => {
    expect(parseOpenTarget('PAN-123', dir, home, { resolveIssue: (raw) => (raw === 'PAN-123' ? 'PAN-123' : null) })).toEqual({
      kind: 'issue',
      id: 'PAN-123',
    });
  });

  it('expands ~ to home', () => {
    expect(parseOpenTarget('~/x', dir, home, noIssue)).toEqual({ kind: 'path', abs: join(home, 'x') });
    expect(parseOpenTarget('~', dir, home, noIssue)).toEqual({ kind: 'path', abs: home });
  });

  it('keeps an existing file literally named a:1 as a path with no line', () => {
    expect(parseOpenTarget('a:1', dir, home, noIssue)).toEqual({ kind: 'path', abs: join(dir, 'a:1') });
    expect(parseOpenTarget('a:1:5', dir, home, noIssue)).toEqual({ kind: 'path', abs: join(dir, 'a:1'), line: 5 });
  });

  it('accepts an absolute path regardless of cwd', () => {
    expect(parseOpenTarget(join(dir, 'f.ts'), '/', home, noIssue)).toEqual({ kind: 'path', abs: join(dir, 'f.ts') });
  });
});
