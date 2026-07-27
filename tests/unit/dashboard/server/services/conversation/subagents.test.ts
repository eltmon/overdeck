import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listSubagentMetas,
  subagentTranscriptPath,
  subagentsDirFor,
} from '../../../../../../src/dashboard/server/services/conversation/subagents.js';

let tempDir: string;
let sessionFile: string;

async function writeMeta(agentId: string, meta: unknown): Promise<void> {
  const subagentsDir = subagentsDirFor(sessionFile);
  await mkdir(subagentsDir, { recursive: true });
  await writeFile(join(subagentsDir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
}

describe('conversation subagent discovery', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'overdeck-subagents-'));
    sessionFile = join(tempDir, 'session.jsonl');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers subagent metadata with ids derived from filenames', async () => {
    await writeMeta('alpha', {
      agentType: 'Explore',
      description: 'Find the conversation parser',
      toolUseId: 'toolu_alpha',
      spawnDepth: 1,
    });
    await writeMeta('beta-2', {
      agentType: 'general-purpose',
      description: 'Trace the message stream',
      toolUseId: 'toolu_beta',
      spawnDepth: 2,
    });

    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([
      {
        agentId: 'alpha',
        agentType: 'Explore',
        description: 'Find the conversation parser',
        toolUseId: 'toolu_alpha',
        spawnDepth: 1,
      },
      {
        agentId: 'beta-2',
        agentType: 'general-purpose',
        description: 'Trace the message stream',
        toolUseId: 'toolu_beta',
        spawnDepth: 2,
      },
    ]);
  });

  it('returns an empty list for absent and empty subagent directories', async () => {
    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([]);

    await mkdir(subagentsDirFor(sessionFile), { recursive: true });
    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([]);
  });

  it('warns and skips corrupt metadata while preserving valid entries', async () => {
    await writeMeta('valid', {
      agentType: 'Explore',
      description: 'Inspect valid metadata',
      toolUseId: 'toolu_valid',
      spawnDepth: 1,
    });
    await mkdir(subagentsDirFor(sessionFile), { recursive: true });
    await writeFile(join(subagentsDirFor(sessionFile), 'agent-corrupt.meta.json'), '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(listSubagentMetas(sessionFile)).resolves.toEqual([
      {
        agentId: 'valid',
        agentType: 'Explore',
        description: 'Inspect valid metadata',
        toolUseId: 'toolu_valid',
        spawnDepth: 1,
      },
    ]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('resolves valid transcript ids inside the subagents directory and rejects unsafe ids', () => {
    expect(subagentTranscriptPath(sessionFile, 'alpha_2')).toBe(
      join(subagentsDirFor(sessionFile), 'agent-alpha_2.jsonl'),
    );
    expect(subagentTranscriptPath(sessionFile, '../evil')).toBeNull();
    expect(subagentTranscriptPath(sessionFile, 'a/b')).toBeNull();
    expect(subagentTranscriptPath(sessionFile, 'agent.id')).toBeNull();
  });
});
