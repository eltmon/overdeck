/**
 * PAN-5526: `pan plan finalize` reads auto-start consent through the shared
 * v2-aware reader (readAutoSpawnOnFinalizeFlagAsync), not the deleted legacy
 * field. It must word its output correctly for granted/legacy/spent/missing
 * consent, and reading consent for reporting must never write it (NFR-1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'fs/promises';
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
import { autoSpawnOnFinalizeFlagPath, writeAutoSpawnOnFinalizeFlag } from '../../../src/lib/planning/auto-spawn-consent.js';
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
  const root = await mkdtemp(join(tmpdir(), 'plan-finalize-consent-'));
  tmpDirs.push(root);
  const workspace = join(root, 'feature-pan-9999');
  await mkdir(join(workspace, '.overdeck'), { recursive: true });
  await mkdir(join(workspace, '.pan', 'drafts'), { recursive: true });
  await writeFile(join(workspace, '.overdeck', 'spec.vbrief.json'), JSON.stringify(doc, null, 2), 'utf8');
  await writeFile(join(workspace, '.pan', 'drafts', 'PAN-9999.md'), PRD_DRAFT, 'utf8');
  return workspace;
}

let overdeckHome: string;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(status: number, body: unknown): void {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(async () => {
  exits.length = 0;
  vi.clearAllMocks();
  vi.mocked(assess).mockResolvedValue({ status: 'unavailable', reason: 'disabled' });
  overdeckHome = await mkdtemp(join(tmpdir(), 'plan-finalize-consent-home-'));
  tmpDirs.push(overdeckHome);
  vi.stubEnv('OVERDECK_HOME', overdeckHome);
  vi.stubEnv('OVERDECK_DASHBOARD_URL', 'http://127.0.0.1:3011');
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

function activityEntryMessages(): string[] {
  return vi.mocked(emitActivityEntry).mock.calls.map(call => call[0].message);
}

function activityTtsUtterances(): string[] {
  return vi.mocked(emitActivityTts).mock.calls.map(call => call[0].utterance);
}

async function readMarker(workspace: string): Promise<{ autoSpawnRequested: boolean } | null> {
  try {
    const raw = await readFile(join(workspace, '.overdeck', 'pending-promotion.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

describe('plan-finalize auto-start consent reporting (PAN-5526)', () => {
  it('granted v2 consent: announces promoting with auto-start, marker requests auto-spawn, never says starting implementation', async () => {
    const consentPath = autoSpawnOnFinalizeFlagPath('PAN-9999');
    await writeAutoSpawnOnFinalizeFlag('PAN-9999', true);
    const before = await readFile(consentPath);

    stubFetch(200, {
      success: true,
      workAgentSpawned: false,
      workAgentSkipReason: 'guardrails',
      workAgentError: 'Agent ceiling reached',
      workAgentDeferred: true,
    });
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace });

    expect(capturedLines().some(line => line.includes('Work agent start deferred'))).toBe(true);
    expect(activityEntryMessages().some(message => message.includes('promoting with auto-start'))).toBe(true);
    expect([...activityEntryMessages(), ...capturedLines()].some(line => line.includes('starting implementation'))).toBe(false);
    expect(activityTtsUtterances().some(utterance => utterance.includes('starting implementation'))).toBe(false);

    const after = await readFile(consentPath);
    expect(after.equals(before)).toBe(true);
  });

  it('legacy v1 consent: still treated as granted, marker records autoSpawnRequested true', async () => {
    const consentPath = autoSpawnOnFinalizeFlagPath('PAN-9999');
    await mkdir(join(overdeckHome, 'agents', 'planning-pan-9999'), { recursive: true });
    await writeFile(consentPath, JSON.stringify({ autoSpawnOnFinalize: true }), 'utf8');

    stubFetch(500, { error: 'boom' });
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace });

    const marker = await readMarker(workspace);
    expect(marker?.autoSpawnRequested).toBe(true);
  });

  it('spent consent: treated as manual, marker records autoSpawnRequested false, activity says awaiting your approval', async () => {
    await writeAutoSpawnOnFinalizeFlag('PAN-9999', false);

    stubFetch(500, { error: 'boom' });
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace });

    const marker = await readMarker(workspace);
    expect(marker?.autoSpawnRequested).toBe(false);
    expect(activityEntryMessages().some(message => message.includes('awaiting your approval'))).toBe(true);
  });

  it('no consent record: manual path, prints the pan start hint', async () => {
    stubFetch(200, { success: true });
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace });

    expect(capturedLines().some(line => line.includes('Run `pan start PAN-9999`'))).toBe(true);
  });
});
