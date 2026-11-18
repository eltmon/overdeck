/**
 * PAN-5526: when complete-planning does not confirm promotion, finalize must
 * say so honestly — never promise a deacon-driven recovery that does not
 * exist — and must announce the failure in the activity feed and TTS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const exits: number[] = [];
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: vi.fn(async (code: number) => {
    exits.push(code);
  }),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityTts: vi.fn(),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  findProjectByPath: () => null,
  getProjectSwarmHotspots: () => [],
}));

vi.mock('../../../src/lib/jev/client.js', () => ({
  assess: vi.fn(),
}));

vi.mock('../../../src/lib/planning/plan-critique-io.js', () => ({
  isPlanFlagged: vi.fn(async () => false),
  loadCritiqueGateInput: vi.fn(),
}));

import { planFinalizeCommand } from '../../../src/cli/commands/plan-finalize.js';
import { assess } from '../../../src/lib/jev/client.js';
import { emitActivityEntry, emitActivityTts } from '../../../src/lib/activity-logger.js';
import type { XBriefDocument, XBriefItem } from '../../../src/lib/xbrief/types.js';

function ac(id: string, title: string) {
  return { id, title, status: 'pending' as const, metadata: { kind: 'acceptance_criterion' } };
}

function makeItem(): XBriefItem {
  return {
    id: 'item-1',
    title: 'Implement behavior',
    status: 'pending',
    narrative: { Action: 'Implement the behavior with explicit files and verification steps' },
    metadata: {
      kind: 'backend',
      requiresInspection: false,
      files_scope: ['src/item-1.ts'],
      files_scope_confidence: 'high',
      readiness: 'sequential',
    },
    subItems: [
      ac('ac1', 'Given a valid request then it returns success'),
      ac('ac2', 'The command rejects invalid requests with a clear error'),
    ],
  };
}

function makeDoc(item: XBriefItem): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.5', created: '2026-06-12T00:00:00Z' },
    plan: {
      id: 'PAN-9999',
      title: 'Plan',
      status: 'proposed',
      metadata: { docsJustification: 'Fixture plan; docs coverage is exercised in its own suite' },
      items: [item],
      edges: [],
    },
  };
}

const PRD_DRAFT = Array.from({ length: 22 }, (_, i) => `Line ${i + 1} of the PAN-9999 implementation brief.`).join('\n');

const tmpDirs: string[] = [];

async function makeWorkspace(doc: XBriefDocument): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plan-finalize-promote-fail-'));
  tmpDirs.push(root);
  const workspace = join(root, 'feature-pan-9999');
  await mkdir(join(workspace, '.overdeck'), { recursive: true });
  await mkdir(join(workspace, '.pan', 'drafts'), { recursive: true });
  await writeFile(join(workspace, '.overdeck', 'spec.vbrief.json'), JSON.stringify(doc, null, 2), 'utf8');
  await writeFile(join(workspace, '.pan', 'drafts', 'PAN-9999.md'), PRD_DRAFT, 'utf8');
  return workspace;
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  exits.length = 0;
  vi.clearAllMocks();
  vi.mocked(assess).mockResolvedValue({ status: 'unavailable', reason: 'disabled' });
  const overdeckHome = await mkdtemp(join(tmpdir(), 'plan-finalize-promote-fail-home-'));
  tmpDirs.push(overdeckHome);
  vi.stubEnv('OVERDECK_HOME', overdeckHome);
  vi.stubEnv('OVERDECK_DASHBOARD_URL', 'http://127.0.0.1:3011');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })));
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  await Promise.all(tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function capturedLines(): string[] {
  return [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls].map(call => String(call[0]));
}

describe('plan-finalize promotion-not-confirmed message (PAN-5526)', () => {
  it('marker written: exits 1, says Promotion was not confirmed, names pan plan done, never mentions the deacon', async () => {
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace });

    expect(exits).toEqual([1]);
    const lines = capturedLines();
    expect(lines.some(line => line.includes('Promotion was not confirmed') && line.includes('pan plan done PAN-9999'))).toBe(true);
    expect(lines.some(line => /deacon/i.test(line))).toBe(false);
    expect(lines.some(line => /automatically once/i.test(line))).toBe(false);

    const marker = await readFile(join(workspace, '.overdeck', 'pending-promotion.json'), 'utf8');
    expect(marker).toBeTruthy();

    const entryCalls = vi.mocked(emitActivityEntry).mock.calls;
    expect(entryCalls.some(([entry]) => entry.level === 'error' && entry.message.includes('plan promotion not confirmed'))).toBe(true);
    const ttsCalls = vi.mocked(emitActivityTts).mock.calls;
    expect(ttsCalls.some(([tts]) => tts.utterance.includes('was not confirmed'))).toBe(true);
  });

  it('marker write fails: says the marker could not be written, names pan plan done, never mentions the deacon', async () => {
    const workspace = await makeWorkspace(makeDoc(makeItem()));
    await mkdir(join(workspace, '.overdeck', 'pending-promotion.json.tmp'), { recursive: true });

    await planFinalizeCommand({ workspace });

    const lines = capturedLines();
    expect(lines.some(line => line.includes('marker could not be written') && line.includes('pan plan done PAN-9999'))).toBe(true);
    expect(lines.some(line => /deacon/i.test(line))).toBe(false);
  });
});
