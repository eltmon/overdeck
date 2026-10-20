/**
 * PAN-4562: the activity summary picks its parser from the declared transcript
 * kind, through an exhaustive table, never by comparing harness names.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParseResult } from '../types.js';

const parsers = vi.hoisted(() => {
  const result = () => ({
    messages: [], workLog: [], byteOffset: 0, streaming: false, totalCost: 0, totalTokens: 0,
    latestAssistantUsage: null, observedEffort: null, contextBoundaryOffset: 0, contextActiveBytes: 0,
    pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: 0, mtimeMs: 0,
  }) as unknown as ParseResult;
  return {
    codex: vi.fn(async () => result()),
    ohmypi: vi.fn(async () => result()),
    pi: vi.fn(async () => result()),
    muse: vi.fn(async () => result()),
    prime: vi.fn(async () => result()),
    kimi: vi.fn(async () => result()),
    claude: vi.fn(async () => result()),
    acp: vi.fn(async () => ({ messages: [], streaming: false, pendingToolCount: 0, currentTool: null, mtimeMs: 0 })),
  };
});

vi.mock('../../codex-conversation-parser.js', () => ({ parseCodexConversationMessages: parsers.codex }));
vi.mock('../../ohmypi-conversation-parser.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ohmypi-conversation-parser.js')>()),
  parseOhmypiConversationMessages: parsers.ohmypi,
}));
vi.mock('../../pi-conversation-parser.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../pi-conversation-parser.js')>()),
  parsePiConversationMessages: parsers.pi,
}));
vi.mock('../../muse-conversation-parser.js', () => ({ parseMuseConversationMessages: parsers.muse }));
vi.mock('../../prime-agent-conversation-parser.js', () => ({ parsePrimeAgentConversationMessages: parsers.prime }));
vi.mock('../../kimi-conversation-parser.js', () => ({ parseKimiConversationMessages: parsers.kimi }));
vi.mock('../../acp-conversation-parser.js', () => ({ projectAcpConversationActivity: parsers.acp }));
vi.mock('../parser.js', () => ({ parseFromLastCompactBoundary: parsers.claude }));

const { summarizeConversationActivity } = await import('../activity-summary.js');

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `overdeck-activity-sources-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
  for (const parser of Object.values(parsers)) parser.mockClear();
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function transcript(relativePath: string): Promise<string> {
  const path = join(testDir, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '{}\n');
  return path;
}

function calledParsers(): string[] {
  return Object.entries(parsers).filter(([, parser]) => parser.mock.calls.length > 0).map(([name]) => name);
}

describe('summarizeConversationActivity parser selection (PAN-4562)', () => {
  it.each([
    ['codex', 'codex'],
    ['ohmypi', 'ohmypi'],
    ['pi', 'ohmypi'],
    ['muse', 'muse'],
    ['prime-agent', 'prime'],
    ['kimi-code', 'kimi'],
    ['acp', 'acp'],
    ['opencode', 'acp'],
    ['claude-code', 'claude'],
    [null, 'claude'],
  ] as const)('harness %s uses only the %s parser', async (harness, parser) => {
    const file = await transcript(`${harness ?? 'none'}/session.jsonl`);
    await summarizeConversationActivity(file, { harness });
    expect(calledParsers()).toEqual([parser]);
  });

  it('a claude-harness transcript under an agent sessions/ dir still uses the ohmypi parser', async () => {
    const file = await transcript('.overdeck/agents/agent-x/sessions/legacy.jsonl');
    await summarizeConversationActivity(file, { harness: 'claude-code' });
    expect(calledParsers()).toEqual(['ohmypi']);
  });
});
