import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HashResolver, extractHashFromJsonlPath } from '../hash-resolver.js';
import { encodeClaudeProjectDir } from '../../paths.js';

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = join(tmpdir(), `pan-457-hash-test-${Date.now()}`);
  mkdirSync(join(tmpRoot, 'Projects', 'myapp'), { recursive: true });
  mkdirSync(join(tmpRoot, 'Projects', 'otherapp'), { recursive: true });
  mkdirSync(join(tmpRoot, 'Projects', '.hidden'), { recursive: true });
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('extractHashFromJsonlPath', () => {
  it('extracts hash from a standard ~/.claude/projects path', () => {
    const hash = extractHashFromJsonlPath(
      '/home/user/.claude/projects/-home-user-Projects-myapp/sessions/abc.jsonl',
    );
    expect(hash).toBe('-home-user-Projects-myapp');
  });

  it('extracts hash from a directly nested JSONL', () => {
    const hash = extractHashFromJsonlPath(
      '/home/user/.claude/projects/-home-user-other/abc.jsonl',
    );
    expect(hash).toBe('-home-user-other');
  });
});

describe('HashResolver', () => {
  it('JSONL-cwd primary: resolves from cwdFromFirstMessage when present', async () => {
    const resolver = new HashResolver([join(tmpRoot, 'Projects')]);
    const jsonlPath = '/any/.claude/projects/-irrelevant/sess.jsonl';
    const result = await resolver.resolve(jsonlPath, '/home/user/Projects/myapp');
    expect(result.workspacePath).toBe('/home/user/Projects/myapp');
    expect(result.strategy).toBe('jsonl-cwd');
  });

  it('reverse-map fallback: resolves hash to known workspace when JSONL has no cwd', async () => {
    const workspacePath = join(tmpRoot, 'Projects', 'myapp');
    const hash = encodeClaudeProjectDir(workspacePath);
    const jsonlPath = `/home/user/.claude/projects/${hash}/sess.jsonl`;

    const resolver = new HashResolver([join(tmpRoot, 'Projects')]);
    const result = await resolver.resolve(jsonlPath, null);

    expect(result.workspacePath).toBe(workspacePath);
    expect(result.strategy).toBe('reverse-map');
    expect(result.workspaceHash).toBe(hash);
  });

  it('returns null (not crash) when hash is unknown and no JSONL cwd', async () => {
    const resolver = new HashResolver([join(tmpRoot, 'Projects')]);
    const result = await resolver.resolve(
      '/home/user/.claude/projects/-unknown-workspace-xyz/sess.jsonl',
      null,
    );
    expect(result.workspacePath).toBeNull();
    expect(result.strategy).toBe('unresolved');
  });

  it('reverse map is built once per resolver instance (cache)', async () => {
    const workspacePath = join(tmpRoot, 'Projects', 'otherapp');
    const hash = encodeClaudeProjectDir(workspacePath);

    const resolver = new HashResolver([join(tmpRoot, 'Projects')]);
    // Call twice — only one FS walk should happen (cache hit on second call)
    await resolver.resolve(`/a/.claude/projects/${hash}/s1.jsonl`, null);
    await resolver.resolve(`/a/.claude/projects/${hash}/s2.jsonl`, null);

    // Both calls should return the correct workspace
    const r = await resolver.resolve(`/a/.claude/projects/${hash}/s3.jsonl`, null);
    expect(r.workspacePath).toBe(workspacePath);
  });

  it('does not include hidden directories in reverse map', async () => {
    // .hidden dir is created in beforeAll — it should not appear in the reverse map
    const hiddenPath = join(tmpRoot, 'Projects', '.hidden');
    const hash = encodeClaudeProjectDir(hiddenPath);

    const resolver = new HashResolver([join(tmpRoot, 'Projects')]);
    const result = await resolver.resolve(
      `/home/user/.claude/projects/${hash}/sess.jsonl`,
      null,
    );
    // .hidden is skipped by the walker, so hash is unresolved
    expect(result.workspacePath).toBeNull();
    expect(result.strategy).toBe('unresolved');
  });

  it('returns null with a warning for ambiguous reverse-map hash collisions', async () => {
    const a = join(tmpRoot, 'Projects', 'foo_bar');
    const b = join(tmpRoot, 'Projects', 'foo:bar');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const hash = encodeClaudeProjectDir(a);

    const resolver = new HashResolver([join(tmpRoot, 'Projects')]);
    const result = await resolver.resolve(`/home/user/.claude/projects/${hash}/sess.jsonl`, null);
    expect(result.workspacePath).toBeNull();
    expect(result.strategy).toBe('unresolved');
    expect(result.warning).toContain('Ambiguous Claude project hash');
  });
});
