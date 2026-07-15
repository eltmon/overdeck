import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionClaudePlugins } from '../../../src/lib/claude-plugins-provision.js';

describe('provisionClaudePlugins', () => {
  let dir: string;
  let manifestPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plugins-provision-'));
    manifestPath = join(dir, 'plugins.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Fake `claude` CLI: records calls, serves canned list output. */
  function fakeExec(state: { installed: string[]; marketplaces: string[]; calls: string[][]; failOn?: string }) {
    return async (cmd: string, args: string[]) => {
      state.calls.push([cmd, ...args]);
      const joined = args.join(' ');
      if (state.failOn && joined.startsWith(state.failOn)) {
        throw new Error(`fake failure: ${joined}`);
      }
      if (joined === 'plugin list --json') {
        return { stdout: JSON.stringify(state.installed.map((id) => ({ id, enabled: true }))) };
      }
      if (joined === 'plugin marketplace list --json') {
        return { stdout: JSON.stringify(state.marketplaces.map((name) => ({ name }))) };
      }
      return { stdout: '' };
    };
  }

  it('returns ok with nothing to do when the manifest is absent', async () => {
    const result = await provisionClaudePlugins({ manifestPath: join(dir, 'missing.json') });
    expect(result).toEqual({ ok: true, installed: [], alreadyInstalled: [], errors: [] });
  });

  it('rejects an invalid manifest without running any commands', async () => {
    writeFileSync(manifestPath, JSON.stringify([{ plugin: 'no-marketplace-suffix', marketplace: 'a/b' }]));
    const state = { installed: [], marketplaces: [], calls: [] as string[][] };
    const result = await provisionClaudePlugins({ manifestPath, exec: fakeExec(state) });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('invalid plugin manifest');
    expect(state.calls).toEqual([]);
  });

  it('installs a missing plugin, adding its marketplace first', async () => {
    writeFileSync(manifestPath, JSON.stringify([{ plugin: 'codex@openai-codex', marketplace: 'openai/codex-plugin-cc' }]));
    const state = { installed: [], marketplaces: [], calls: [] as string[][] };
    const result = await provisionClaudePlugins({ manifestPath, exec: fakeExec(state) });
    expect(result.ok).toBe(true);
    expect(result.installed).toEqual(['codex@openai-codex']);
    expect(result.errors).toEqual([]);
    expect(state.calls).toContainEqual(['claude', 'plugin', 'marketplace', 'add', 'openai/codex-plugin-cc']);
    expect(state.calls).toContainEqual(['claude', 'plugin', 'install', 'codex@openai-codex', '--scope', 'user']);
  });

  it('skips marketplace add when the marketplace already exists', async () => {
    writeFileSync(manifestPath, JSON.stringify([{ plugin: 'codex@openai-codex', marketplace: 'openai/codex-plugin-cc' }]));
    const state = { installed: [], marketplaces: ['openai-codex'], calls: [] as string[][] };
    const result = await provisionClaudePlugins({ manifestPath, exec: fakeExec(state) });
    expect(result.installed).toEqual(['codex@openai-codex']);
    expect(state.calls.some((c) => c.includes('add'))).toBe(false);
  });

  it('is idempotent for already-installed plugins', async () => {
    writeFileSync(manifestPath, JSON.stringify([{ plugin: 'codex@openai-codex', marketplace: 'openai/codex-plugin-cc' }]));
    const state = { installed: ['codex@openai-codex'], marketplaces: ['openai-codex'], calls: [] as string[][] };
    const result = await provisionClaudePlugins({ manifestPath, exec: fakeExec(state) });
    expect(result.installed).toEqual([]);
    expect(result.alreadyInstalled).toEqual(['codex@openai-codex']);
    // Only the two list calls — no add, no install.
    expect(state.calls).toHaveLength(2);
  });

  it('reports a per-plugin error when install fails, without failing the run', async () => {
    writeFileSync(manifestPath, JSON.stringify([
      { plugin: 'codex@openai-codex', marketplace: 'openai/codex-plugin-cc' },
      { plugin: 'other@some-market', marketplace: 'some/market' },
    ]));
    const state = {
      installed: [],
      marketplaces: ['openai-codex', 'some-market'],
      calls: [] as string[][],
      failOn: 'plugin install codex@openai-codex',
    };
    const result = await provisionClaudePlugins({ manifestPath, exec: fakeExec(state) });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('codex@openai-codex');
    expect(result.installed).toEqual(['other@some-market']);
  });

  it('returns not-ok when the claude CLI is unavailable', async () => {
    writeFileSync(manifestPath, JSON.stringify([{ plugin: 'codex@openai-codex', marketplace: 'openai/codex-plugin-cc' }]));
    const exec = async () => { throw new Error('ENOENT'); };
    const result = await provisionClaudePlugins({ manifestPath, exec });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('claude CLI not available');
  });
});
