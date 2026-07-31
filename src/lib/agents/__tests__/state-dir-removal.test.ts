import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeAgentStateDir } from '../state-dir-removal.js';

let tempRoot: string;
let agentDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'state-dir-removal-'));
  agentDir = join(tempRoot, 'agent-pan-3357');
  mkdirSync(agentDir);
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
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
