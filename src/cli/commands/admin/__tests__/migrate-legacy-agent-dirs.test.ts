import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  migrateLegacyAgentDirs,
  resolveLegacyAgentDirMigrationHomes,
  runMigrateLegacyAgentDirsCommand,
} from '../migrate-legacy-agent-dirs.js';

let legacyHome: string;
let currentHome: string;
let previousOverdeckHome: string | undefined;

beforeEach(() => {
  legacyHome = mkdtempSync(join(tmpdir(), 'legacy-agent-home-'));
  currentHome = mkdtempSync(join(tmpdir(), 'current-agent-home-'));
  previousOverdeckHome = process.env.OVERDECK_HOME;
});

afterEach(() => {
  if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousOverdeckHome;
  rmSync(legacyHome, { recursive: true, force: true });
  rmSync(currentHome, { recursive: true, force: true });
});

describe('migrateLegacyAgentDirs', () => {
  it('copies missing conv dirs recursively while preserving file mtimes', async () => {
    const sourceDir = join(legacyHome, 'agents', 'conv-20260714-3489');
    const sourceTranscript = join(sourceDir, 'codex-home', 'sessions', 'rollout.jsonl');
    mkdirSync(join(sourceDir, 'codex-home', 'sessions'), { recursive: true });
    writeFileSync(sourceTranscript, '{"event":"restored"}\n');
    const originalMtime = new Date('2026-07-20T08:30:00.000Z');
    utimesSync(sourceTranscript, originalMtime, originalMtime);

    const log = vi.fn();
    const result = await runMigrateLegacyAgentDirsCommand({ legacyHome, currentHome }, log);
    const copiedTranscript = join(currentHome, 'agents', 'conv-20260714-3489', 'codex-home', 'sessions', 'rollout.jsonl');

    expect(result).toEqual({ copied: 1, skipped: 0 });
    expect(log).toHaveBeenCalledWith('copied 1, skipped 0');
    expect(existsSync(copiedTranscript)).toBe(true);
    expect(statSync(copiedTranscript).mtimeMs).toBe(originalMtime.getTime());
    expect(existsSync(sourceTranscript)).toBe(true);
  });

  it('is idempotent and never overwrites an existing destination', async () => {
    const sourceDir = join(legacyHome, 'agents', 'conv-existing');
    const destinationDir = join(currentHome, 'agents', 'conv-existing');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'session.jsonl'), 'legacy\n');

    await expect(migrateLegacyAgentDirs({ legacyHome, currentHome })).resolves.toEqual({
      copied: 1,
      skipped: 0,
    });
    writeFileSync(join(destinationDir, 'session.jsonl'), 'current\n');

    const second = await migrateLegacyAgentDirs({ legacyHome, currentHome });

    expect(second).toEqual({ copied: 0, skipped: 1 });
    expect(statSync(join(destinationDir, 'session.jsonl')).size).toBe('current\n'.length);
  });

  it('heals a copy interrupted after writing partial temporary data', async () => {
    const sourceDir = join(legacyHome, 'agents', 'conv-interrupted');
    const sourceTranscript = join(sourceDir, 'sessions', 'complete.jsonl');
    mkdirSync(join(sourceDir, 'sessions'), { recursive: true });
    writeFileSync(sourceTranscript, 'complete\n');

    await expect(migrateLegacyAgentDirs({
      legacyHome,
      currentHome,
      deps: {
        copy: async (_source, destination) => {
          mkdirSync(destination, { recursive: true });
          writeFileSync(join(destination, 'partial.jsonl'), 'partial\n');
          throw new Error('copy interrupted');
        },
      },
    })).rejects.toThrow('copy interrupted');

    const currentAgentsDir = join(currentHome, 'agents');
    expect(existsSync(join(currentAgentsDir, 'conv-interrupted'))).toBe(false);
    expect(readdirSync(currentAgentsDir)).toEqual([]);

    await expect(migrateLegacyAgentDirs({ legacyHome, currentHome })).resolves.toEqual({
      copied: 1,
      skipped: 0,
    });
    expect(existsSync(join(currentAgentsDir, 'conv-interrupted', 'sessions', 'complete.jsonl'))).toBe(true);
  });

  it('exits as a no-op when the legacy agents dir is absent', async () => {
    await expect(migrateLegacyAgentDirs({ legacyHome, currentHome })).resolves.toEqual({
      copied: 0,
      skipped: 0,
    });
    expect(existsSync(join(currentHome, 'agents'))).toBe(false);
  });

  it('resolves the configured Overdeck home dynamically', () => {
    process.env.OVERDECK_HOME = currentHome;

    expect(resolveLegacyAgentDirMigrationHomes()).toEqual({
      legacyHome: join(homedir(), '.panopticon'),
      currentHome,
    });
  });
});
