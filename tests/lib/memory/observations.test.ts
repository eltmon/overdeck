import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryObservation } from '@panctl/contracts';
import {
  observationMarkdownPath,
  renderObservationMarkdownLine,
  writeObservation,
} from '../../../src/lib/memory/observations.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

function observation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: 'obs-1',
    timestamp: '2026-05-16T20:33:00.000Z',
    ...identity,
    gitBranch: 'feature/pan-1052',
    sourceTranscriptOffset: 123,
    actionStatus: 'Implemented observation writer',
    narrative: 'The observation writer now persists JSONL and markdown.',
    summary: 'Observation writer persists activity entries.',
    files: ['src/lib/memory/observations.ts'],
    tags: ['handoff'],
    tokens: { prompt: 10, completion: 5, total: 15 },
    model: 'stub-model',
    ...overrides,
  };
}

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-observations-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('observation writer', () => {
  it('appends observations to date-scoped JSONL and updates the markdown mirror', async () => {
    const entry = observation();
    const result = await writeObservation(entry);

    expect(result).toEqual({
      jsonlPath: join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.jsonl'),
      markdownPath: join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.md'),
    });
    expect(observationMarkdownPath(entry)).toBe(result.markdownPath);

    const jsonl = await readFile(result.jsonlPath, 'utf8');
    expect(jsonl.trim().split('\n').map((line) => JSON.parse(line))).toEqual([entry]);

    const markdown = await readFile(result.markdownPath, 'utf8');
    expect(markdown).toBe(`${renderObservationMarkdownLine(entry)}\n`);
  });

  it('uses O_APPEND for JSONL while keeping markdown mirror idempotent by observation id', async () => {
    const first = observation({ actionStatus: 'First status' });
    const second = observation({ actionStatus: 'Updated status', summary: 'Updated summary.' });

    await writeObservation(first);
    await writeObservation(second);

    const jsonlPath = join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.jsonl');
    const markdownPath = join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.md');

    const jsonlEntries = (await readFile(jsonlPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(jsonlEntries).toHaveLength(2);
    expect(jsonlEntries.map((entry) => entry.actionStatus)).toEqual(['First status', 'Updated status']);

    const markdown = await readFile(markdownPath, 'utf8');
    expect(markdown).toContain('Updated status');
    expect(markdown).not.toContain('First status');
    expect(markdown.match(/<!-- obs:obs-1 -->/g)).toHaveLength(1);

    const files = await readdir(join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations'));
    expect(files.sort()).toEqual(['2026-05-16.jsonl', '2026-05-16.md']);
  });

  it('renders summary when actionStatus is null and compacts multiline fields', () => {
    const line = renderObservationMarkdownLine(observation({
      actionStatus: null,
      summary: 'Discussed\nnext steps',
      files: [],
      tags: [],
    }));

    expect(line).toBe('- <!-- obs:obs-1 --> **20:33** Discussed next steps');
  });
});
