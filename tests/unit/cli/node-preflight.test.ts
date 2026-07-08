import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseNodeVersion,
  meetsMinimum,
  candidateNodePaths,
  findCompatibleNode,
  detectVersionManagerHint,
  type NodeCandidate,
} from '../../../src/cli/node-preflight.js';

describe('parseNodeVersion', () => {
  it('parses a v-prefixed version', () => {
    expect(parseNodeVersion('v22.23.1')).toEqual({ major: 22, minor: 23 });
  });
  it('parses a bare version', () => {
    expect(parseNodeVersion('20.19.0')).toEqual({ major: 20, minor: 19 });
  });
  it('trims surrounding whitespace', () => {
    expect(parseNodeVersion('  v24.15.0\n')).toEqual({ major: 24, minor: 15 });
  });
  it('returns null for garbage', () => {
    expect(parseNodeVersion('not-a-version')).toBeNull();
  });
});

describe('meetsMinimum', () => {
  it('rejects Node 20', () => {
    expect(meetsMinimum({ major: 20 })).toBe(false);
  });
  it('accepts Node 22', () => {
    expect(meetsMinimum({ major: 22 })).toBe(true);
  });
  it('accepts Node 24', () => {
    expect(meetsMinimum({ major: 24 })).toBe(true);
  });
});

describe('findCompatibleNode', () => {
  const cand = (path: string, major: number, minor: number): NodeCandidate => ({
    path,
    version: `v${major}.${minor}.0`,
    major,
    minor,
  });

  it('returns the highest compatible candidate', () => {
    const probe = (p: string): NodeCandidate | null => {
      if (p === '/a/node') return cand(p, 22, 5);
      if (p === '/b/node') return cand(p, 24, 15);
      if (p === '/c/node') return cand(p, 22, 23);
      return null;
    };
    const best = findCompatibleNode(['/a/node', '/b/node', '/c/node'], probe);
    expect(best?.path).toBe('/b/node');
  });

  it('ignores incompatible (old) candidates', () => {
    const probe = (p: string): NodeCandidate | null => {
      if (p === '/old/node') return cand(p, 20, 19);
      if (p === '/new/node') return cand(p, 22, 23);
      return null;
    };
    const best = findCompatibleNode(['/old/node', '/new/node'], probe);
    expect(best?.path).toBe('/new/node');
  });

  it('returns null when nothing is compatible', () => {
    const probe = (p: string): NodeCandidate | null =>
      p === '/old/node' ? cand(p, 20, 19) : null;
    expect(findCompatibleNode(['/old/node', '/missing/node'], probe)).toBeNull();
  });

  it('de-duplicates repeated paths', () => {
    const seen: string[] = [];
    const probe = (p: string): NodeCandidate | null => {
      seen.push(p);
      return cand(p, 22, 23);
    };
    findCompatibleNode(['/x/node', '/x/node'], probe);
    expect(seen).toEqual(['/x/node']);
  });
});

describe('candidateNodePaths', () => {
  it('always includes the Homebrew keg paths', () => {
    const paths = candidateNodePaths('/tmp/nonexistent-home');
    expect(paths).toContain('/opt/homebrew/opt/node@22/bin/node');
    expect(paths).toContain('/opt/homebrew/opt/node@24/bin/node');
  });

  it('expands installed nvm version directories', () => {
    const home = mkdtempSync(join(tmpdir(), 'preflight-nvm-'));
    try {
      mkdirSync(join(home, '.nvm/versions/node/v22.23.1'), { recursive: true });
      mkdirSync(join(home, '.nvm/versions/node/v20.19.0'), { recursive: true });
      const paths = candidateNodePaths(home);
      expect(paths).toContain(join(home, '.nvm/versions/node/v22.23.1/bin/node'));
      expect(paths).toContain(join(home, '.nvm/versions/node/v20.19.0/bin/node'));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('detectVersionManagerHint', () => {
  it('recommends nvm when ~/.nvm exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'preflight-hint-'));
    try {
      mkdirSync(join(home, '.nvm'), { recursive: true });
      expect(detectVersionManagerHint(home)).toContain('nvm install 22');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('recommends volta when ~/.volta exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'preflight-hint-'));
    try {
      mkdirSync(join(home, '.volta'), { recursive: true });
      expect(detectVersionManagerHint(home)).toContain('volta install node@22');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('falls back to the nodejs.org download for a bare home', () => {
    const home = mkdtempSync(join(tmpdir(), 'preflight-hint-'));
    try {
      // No manager dirs; hint depends only on presence of brew or the fallback.
      const hint = detectVersionManagerHint(home);
      expect(hint === 'brew install node@22 && brew link --overwrite node@22' ||
        hint === 'Install Node 22 from https://nodejs.org/en/download').toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
