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

import { removeAgentStateDir } from '../state-dir-removal.js';

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
