import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
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

import { planFinalizeCommand } from '../../../src/cli/commands/plan-finalize.js';
import { assess } from '../../../src/lib/jev/client.js';
import { assertPlanQuality, lintPlanQuality, PlanQualityLintError } from '../../../src/lib/xbrief/quality-lint.js';
import type { XBriefDocument, XBriefItem } from '../../../src/lib/xbrief/types.js';

function ac(id: string, title: string) {
  return { id, title, status: 'pending' as const, metadata: { kind: 'acceptance_criterion' } };
}

function makeItem(acTitles: [string, string] = [
  'Given a valid request then it returns success',
  'The command rejects invalid requests with a clear error',
]): XBriefItem {
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
    subItems: [ac('ac1', acTitles[0]), ac('ac2', acTitles[1])],
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
  const root = await mkdtemp(join(tmpdir(), 'plan-finalize-jev-'));
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

beforeEach(async () => {
  exits.length = 0;
  vi.mocked(assess).mockReset();
  overdeckHome = await mkdtemp(join(tmpdir(), 'plan-finalize-jev-home-'));
  tmpDirs.push(overdeckHome);
  vi.stubEnv('OVERDECK_HOME', overdeckHome);
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  await Promise.all(tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function capturedLines(): string[] {
  return [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls].map(call => String(call[0]));
}

describe('plan-finalize Jev acceptance-criteria review (PAN-4372)', () => {
  it('prints nothing new and does not exit when Jev is unavailable', async () => {
    vi.mocked(assess).mockResolvedValue({ status: 'unavailable', reason: 'disabled' });
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace, promote: false });

    expect(capturedLines().some(line => /ac-semantic|Jev/.test(line))).toBe(false);
    expect(exits).toEqual([]);
  });

  it('prints [warn] ac-semantic-not-observable for a 0.1 noul and does not exit', async () => {
    vi.mocked(assess).mockResolvedValue({
      status: 'answered',
      model: 'test-model-x',
      usage: { input_tokens: 10, output_tokens: 0 },
      answers: {
        observable_ac1: { type: 'noul', noul: 0.1 },
        compound_ac1: { type: 'noul', noul: 0.1 },
        observable_ac2: { type: 'noul', noul: 0.9 },
        compound_ac2: { type: 'noul', noul: 0.1 },
      },
    });
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace, promote: false });

    const errorLines = consoleErrorSpy.mock.calls.map(call => String(call[0]));
    expect(errorLines.some(line => line.includes('[warn] ac-semantic-not-observable') && line.includes('ac1'))).toBe(true);
    expect(exits).toEqual([]);
    expect(assess).toHaveBeenCalledTimes(1);
  });

  it('exits 3 on a keyword-rule error without calling Jev', async () => {
    vi.mocked(assess).mockResolvedValue({
      status: 'answered',
      model: 'test-model-x',
      usage: { input_tokens: 10, output_tokens: 0 },
      answers: { observable_ac2: { type: 'noul', noul: 0.99 } },
    });
    const brokenDoc = makeDoc(makeItem(['Given a valid request then it returns success', 'The response is fine']));
    expect(lintPlanQuality(brokenDoc).filter(i => i.severity === 'error').map(i => i.rule)).toEqual(['ac-not-observable']);
    expect(() => assertPlanQuality(brokenDoc)).toThrow(PlanQualityLintError);
    const workspace = await makeWorkspace(brokenDoc);

    await planFinalizeCommand({ workspace, promote: false });

    expect(exits).toEqual([3]);
    expect(assess).not.toHaveBeenCalled();
  });

  it('skips Jev with --no-quality-lint', async () => {
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace, promote: false, qualityLint: false });

    expect(assess).not.toHaveBeenCalled();
  });

  it('prints one dim line when the review fails', async () => {
    vi.mocked(assess).mockResolvedValue({ status: 'failed', reason: 'timeout', message: 'x' });
    const workspace = await makeWorkspace(makeDoc(makeItem()));

    await planFinalizeCommand({ workspace, promote: false });

    const errorLines = consoleErrorSpy.mock.calls.map(call => String(call[0]));
    const matches = errorLines.filter(line => line.includes('Jev acceptance-criteria review did not run (timeout)'));
    expect(matches).toHaveLength(1);
    expect(exits).toEqual([]);
  });
});
