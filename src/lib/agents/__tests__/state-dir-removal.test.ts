import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../paths.js')>();
  return {
    ...actual,
    get AGENTS_DIR() {
      return process.env.TEST_AGENTS_DIR ?? actual.AGENTS_DIR;
    },
  };
});

import {
  listAgentStateFilesForRemoval,
  pruneAgentStateDir,
  removeAgentSecretsDir,
  removeAgentStateDir,
  removeCodexPluginCaches,
} from '../state-dir-removal.js';

let tempRoot: string;
let outsideDir: string;
let agentDir: string;
let previousAgentsDir: string | undefined;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'state-dir-removal-'));
  outsideDir = mkdtempSync(join(tmpdir(), 'state-dir-removal-outside-'));
  agentDir = join(tempRoot, 'agent-pan-3357');
  mkdirSync(agentDir);
  previousAgentsDir = process.env.TEST_AGENTS_DIR;
  process.env.TEST_AGENTS_DIR = tempRoot;
});

afterEach(() => {
  if (previousAgentsDir === undefined) delete process.env.TEST_AGENTS_DIR;
  else process.env.TEST_AGENTS_DIR = previousAgentsDir;
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

describe('removeAgentStateDir', () => {
  it('lists only the runtime files cleanup would remove', async () => {
    const sessionsDir = join(agentDir, 'sessions');
    mkdirSync(sessionsDir);
    writeFileSync(join(agentDir, 'state.json'), '{}');
    writeFileSync(join(sessionsDir, 'session.jsonl'), '{"kept":true}\n');
    writeFileSync(join(sessionsDir, 'runtime.json'), '{}');

    await expect(listAgentStateFilesForRemoval(agentDir)).resolves.toEqual([
      'sessions/runtime.json',
      'state.json',
    ]);
    expect(readFileSync(join(sessionsDir, 'session.jsonl'), 'utf8')).toBe('{"kept":true}\n');
  });

  it('removes a dir with no jsonl entirely', async () => {
    mkdirSync(join(agentDir, 'git-guard'));
    writeFileSync(join(agentDir, 'state.json'), '{}');
    writeFileSync(join(agentDir, 'git-guard', 'git'), '#!/bin/sh');

    await expect(removeAgentStateDir(agentDir)).resolves.toEqual({
      removedFiles: 2,
      preservedTranscripts: 0,
      removedDir: true,
    });
    expect(existsSync(agentDir)).toBe(false);

    await expect(removeAgentStateDir(agentDir)).resolves.toEqual({
      removedFiles: 0,
      preservedTranscripts: 0,
      removedDir: true,
    });
  });

  it('preserves codex-home/sessions rollouts and deletes runtime residue', async () => {
    const sessionsDir = join(agentDir, 'codex-home', 'sessions', '2026', '07', '31');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'rollout-a.jsonl'), '{"event":"a"}\n');
    writeFileSync(join(sessionsDir, 'rollout-b.jsonl'), '{"event":"b"}\n');
    writeFileSync(join(agentDir, 'state.json'), '{}');
    writeFileSync(join(agentDir, 'session.id'), 'session-1');

    await expect(removeAgentStateDir(agentDir)).resolves.toEqual({
      removedFiles: 2,
      preservedTranscripts: 2,
      removedDir: false,
    });
    expect(readFileSync(join(sessionsDir, 'rollout-a.jsonl'), 'utf8')).toBe('{"event":"a"}\n');
    expect(readFileSync(join(sessionsDir, 'rollout-b.jsonl'), 'utf8')).toBe('{"event":"b"}\n');
    expect(existsSync(join(agentDir, 'state.json'))).toBe(false);
    expect(existsSync(join(agentDir, 'session.id'))).toBe(false);
  });

  it('preserves root-level per-run jsonl (PAN-1908 pi layout)', async () => {
    const residueDir = join(agentDir, 'runtime', 'nested');
    mkdirSync(residueDir, { recursive: true });
    writeFileSync(join(agentDir, 'run-20260731.jsonl'), '{"role":"work"}\n');
    writeFileSync(join(residueDir, 'launcher.sh'), '#!/bin/sh');

    await expect(removeAgentStateDir(agentDir)).resolves.toEqual({
      removedFiles: 1,
      preservedTranscripts: 1,
      removedDir: false,
    });
    expect(readFileSync(join(agentDir, 'run-20260731.jsonl'), 'utf8')).toBe('{"role":"work"}\n');
    expect(existsSync(join(agentDir, 'runtime'))).toBe(false);
  });

  it('rejects a symbolic-link agent root without touching its target', async () => {
    const outsideFile = join(outsideDir, 'keep.txt');
    writeFileSync(outsideFile, 'keep');
    rmSync(agentDir, { recursive: true, force: true });
    symlinkSync(outsideDir, agentDir, 'dir');

    await expect(removeAgentStateDir(agentDir)).rejects.toThrow('refusing symbolic-link root');
    expect(readFileSync(outsideFile, 'utf8')).toBe('keep');
  });

  it('unlinks nested symbolic links without traversing their targets', async () => {
    const outsideFile = join(outsideDir, 'keep.txt');
    const outsideTranscript = join(outsideDir, 'keep.jsonl');
    writeFileSync(outsideFile, 'keep');
    writeFileSync(outsideTranscript, '{}\n');
    const linkPath = join(agentDir, 'linked-runtime.jsonl');
    symlinkSync(outsideDir, linkPath, 'dir');

    await expect(removeAgentStateDir(agentDir)).resolves.toEqual({
      removedFiles: 1,
      preservedTranscripts: 0,
      removedDir: true,
    });
    expect(existsSync(linkPath)).toBe(false);
    expect(readFileSync(outsideFile, 'utf8')).toBe('keep');
    expect(readFileSync(outsideTranscript, 'utf8')).toBe('{}\n');
  });

  it('rejects paths outside AGENTS_DIR', async () => {
    const outsideFile = join(outsideDir, 'keep.txt');
    writeFileSync(outsideFile, 'keep');

    await expect(removeAgentStateDir(outsideDir)).rejects.toThrow('path escapes AGENTS_DIR');
    expect(readFileSync(outsideFile, 'utf8')).toBe('keep');
  });

  it('is idempotent on an already-pruned dir', async () => {
    const transcriptPath = join(agentDir, 'sessions', 'session.jsonl');
    mkdirSync(join(agentDir, 'sessions'));
    writeFileSync(transcriptPath, '{"message":"kept"}\n');
    writeFileSync(join(agentDir, 'pty-token'), 'secret');

    await removeAgentStateDir(agentDir);
    await expect(removeAgentStateDir(agentDir)).resolves.toEqual({
      removedFiles: 0,
      preservedTranscripts: 1,
      removedDir: false,
    });
    expect(readFileSync(transcriptPath, 'utf8')).toBe('{"message":"kept"}\n');
  });
});

describe('pruneAgentStateDir', () => {
  it('removes only regenerable runtime weight and keeps state and transcripts', async () => {
    const state = '{"issueId":"PAN-3950"}\n';
    const sessions = '[{"sessionId":"session-1"}]\n';
    const rolloutDir = join(agentDir, 'codex-home-v2', 'sessions', '2026', '09', '20');
    const cacheDir = join(agentDir, 'codex-home-v2', 'cache');
    mkdirSync(rolloutDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), state);
    writeFileSync(join(agentDir, 'sessions.json'), sessions);
    writeFileSync(join(rolloutDir, 'rollout-x.jsonl'), '{"event":"kept"}\n');
    writeFileSync(join(cacheDir, 'blob'), 'cache');
    writeFileSync(join(agentDir, 'pending.lock'), 'lock');
    writeFileSync(join(agentDir, 'runtime.sock'), 'socket');

    const result = await pruneAgentStateDir(agentDir);

    expect(result.kept).toEqual([
      'codex-home-v2/sessions/2026/09/20/rollout-x.jsonl',
      'sessions.json',
      'state.json',
    ]);
    expect(result.removed).toEqual([
      'codex-home-v2/cache',
      'pending.lock',
      'runtime.sock',
    ]);
    expect(result.bytesFreed).toBeGreaterThanOrEqual(Buffer.byteLength('locksocket'));
    expect(readFileSync(join(agentDir, 'state.json'), 'utf8')).toBe(state);
    expect(readFileSync(join(agentDir, 'sessions.json'), 'utf8')).toBe(sessions);
    expect(readFileSync(join(rolloutDir, 'rollout-x.jsonl'), 'utf8')).toBe('{"event":"kept"}\n');
    expect(existsSync(cacheDir)).toBe(false);
    expect(existsSync(join(agentDir, 'pending.lock'))).toBe(false);
  });

  it('refuses a direct deletion target replaced by a symlink', async () => {
    const outsideFile = join(outsideDir, 'keep.txt');
    writeFileSync(outsideFile, 'keep');
    symlinkSync(outsideDir, join(agentDir, 'pending.lock'), 'dir');

    await expect(pruneAgentStateDir(agentDir)).rejects.toThrow('refusing symbolic-link child');
    expect(readFileSync(outsideFile, 'utf8')).toBe('keep');
  });

  it('refuses a codex-home child symlink without traversing it', async () => {
    const outsideFile = join(outsideDir, 'keep.txt');
    const codexHome = join(agentDir, 'codex-home');
    writeFileSync(outsideFile, 'keep');
    mkdirSync(join(codexHome, 'sessions'), { recursive: true });
    symlinkSync(outsideDir, join(codexHome, 'cache'), 'dir');

    await expect(pruneAgentStateDir(agentDir)).rejects.toThrow('refusing symbolic-link child');
    expect(readFileSync(outsideFile, 'utf8')).toBe('keep');
  });
});

describe('removeCodexPluginCaches (PAN-4727)', () => {
  const cache = (home: string, plugin: string) => join(agentDir, home, 'plugins', 'cache', 'overdeck-packs', plugin);

  it('removes only the named plugin cache in every codex-home and keeps sessions and transcripts', async () => {
    for (const dir of [cache('codex-home', 'gstack'), cache('codex-home-v2', 'gstack'), cache('codex-home', 'mattpocock')]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'x');
    }
    mkdirSync(join(agentDir, 'codex-home', 'sessions'), { recursive: true });
    writeFileSync(join(agentDir, 'codex-home', 'sessions', 'rollout.jsonl'), '{}\n');
    writeFileSync(join(agentDir, 'session.jsonl'), '{}\n');

    const removed = await removeCodexPluginCaches('overdeck-packs', 'gstack', tempRoot);
    expect(removed.sort()).toEqual([cache('codex-home', 'gstack'), cache('codex-home-v2', 'gstack')].sort());
    expect(existsSync(cache('codex-home', 'gstack'))).toBe(false);
    expect(existsSync(cache('codex-home', 'mattpocock'))).toBe(true);
    expect(readFileSync(join(agentDir, 'codex-home', 'sessions', 'rollout.jsonl'), 'utf8')).toBe('{}\n');
    expect(existsSync(join(agentDir, 'session.jsonl'))).toBe(true);
  });

  it('never follows or removes a symlinked cache, and leaves its target alone', async () => {
    mkdirSync(join(agentDir, 'codex-home', 'plugins', 'cache', 'overdeck-packs'), { recursive: true });
    writeFileSync(join(outsideDir, 'keep.txt'), 'x');
    symlinkSync(outsideDir, cache('codex-home', 'gstack'));
    expect(await removeCodexPluginCaches('overdeck-packs', 'gstack', tempRoot)).toEqual([]);
    expect(existsSync(join(outsideDir, 'keep.txt'))).toBe(true);
  });

  it('returns nothing when the agents root is missing and rejects path-like names', async () => {
    expect(await removeCodexPluginCaches('overdeck-packs', 'gstack', join(tempRoot, 'missing'))).toEqual([]);
    await expect(removeCodexPluginCaches('overdeck-packs', '../x', tempRoot)).rejects.toThrow(/invalid name/);
  });
});

describe('removeAgentSecretsDir (PAN-4941)', () => {
  it('deletes only the secrets child and keeps the transcript beside it', async () => {
    mkdirSync(join(agentDir, 'secrets'));
    writeFileSync(join(agentDir, 'secrets', 'OPENAI_API_KEY'), 'v');
    writeFileSync(join(agentDir, 'session.jsonl'), '{}\n');
    await removeAgentSecretsDir(agentDir);
    expect(existsSync(join(agentDir, 'secrets'))).toBe(false);
    expect(readFileSync(join(agentDir, 'session.jsonl'), 'utf8')).toBe('{}\n');
  });

  it('removes a secrets symlink without following it', async () => {
    writeFileSync(join(outsideDir, 'keep'), 'outside');
    symlinkSync(outsideDir, join(agentDir, 'secrets'));
    await removeAgentSecretsDir(agentDir);
    expect(existsSync(join(agentDir, 'secrets'))).toBe(false);
    expect(readFileSync(join(outsideDir, 'keep'), 'utf8')).toBe('outside');
  });

  it('is not an error when there is no secrets directory', async () => {
    await expect(removeAgentSecretsDir(agentDir)).resolves.toBeUndefined();
    await expect(removeAgentSecretsDir(join(tempRoot, 'missing'))).resolves.toBeUndefined();
  });
});
