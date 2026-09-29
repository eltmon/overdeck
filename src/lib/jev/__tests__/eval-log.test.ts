import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Fetch } from '@typesafe-ai/sdk';
import type { CostEvent } from '../../costs/events.js';

// Capture cost events instead of writing them to the JSONL/SQLite ledger.
const captured: CostEvent[] = [];
vi.mock('../../costs/events.js', () => ({
  appendCostEvent: (event: CostEvent) => {
    captured.push(event);
  },
}));

import { defaultBackgroundAiFeatures } from '../../background-ai/registry.js';
import { DEFAULT_NORMALIZED_JEV, type NormalizedJevConfig } from '../../config-yaml/jev.js';
import type { JevConfigInput } from '../config.js';
import { resetJevMemo } from '../memo.js';
import { reviewAcceptanceCriteria } from '../acceptance-criteria.js';
import { resolveAcceptanceCriteriaEvalLogPath } from '../eval-log.js';
import type { XBriefDocument, XBriefItem } from '../../xbrief/types.js';

const FEATURE = 'jevAcceptanceCriteriaReview';
const FIXED_DATE = new Date('2026-09-29T00:00:00Z');
const TITLE_MARKER = 'UNIQUE_TITLE_MARKER_should_never_reach_the_log';

function config(opts: { enabled?: boolean; jev?: Partial<NormalizedJevConfig> } = {}): JevConfigInput {
  return {
    backgroundAi: {
      cheapMode: false,
      features: { ...defaultBackgroundAiFeatures(), [FEATURE]: opts.enabled ?? true },
    },
    jev: { ...DEFAULT_NORMALIZED_JEV, configured: true, model: 'test-model-x', ...opts.jev },
    apiKeys: { typesafe: 'k' },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(respond: (body: Record<string, unknown>) => Promise<Response> | Response) {
  const fetch = vi.fn<Fetch>(async (_url, init) => respond(JSON.parse(String(init?.body)) as Record<string, unknown>));
  return { fetch };
}

function ac(id: string, title: string) {
  return { id, title, status: 'pending' as const, metadata: { kind: 'acceptance_criterion' } };
}

function item(overrides: Partial<XBriefItem> = {}): XBriefItem {
  const id = overrides.id ?? 'item-1';
  return {
    id,
    title: 'Implement behavior',
    status: 'pending',
    subItems: [ac('ac1', `Given a valid request then it returns success`), ac('ac2', TITLE_MARKER)],
    ...overrides,
  };
}

function doc(items: XBriefItem[]): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.5', created: '2026-06-12T00:00:00Z' },
    plan: { id: 'PAN-4372', title: 'Plan', status: 'proposed', items, edges: [] },
  };
}

const tmpDirs: string[] = [];
async function tmpHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jev-eval-log-'));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  resetJevMemo();
  captured.length = 0;
});

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('eval log (PAN-4372 WI-2)', () => {
  it('appends one line per AC with keyword verdict and nouls', async () => {
    const home = await tmpHome();
    const { fetch } = fakeFetch(() =>
      jsonResponse({
        model: 'test-model-x',
        answers: {
          observable_ac1: { type: 'noul', noul: 0.9 },
          compound_ac1: { type: 'noul', noul: 0.1 },
          observable_ac2: { type: 'noul', noul: 0.2 },
          compound_ac2: { type: 'noul', noul: 0.8 },
        },
        usage: { input_tokens: 40, output_tokens: 0 },
      }),
    );

    await reviewAcceptanceCriteria(doc([item()]), {
      config: config(),
      fetch,
      env: {},
      evalLogHome: home,
      now: () => FIXED_DATE,
    });

    const logPath = resolveAcceptanceCriteriaEvalLogPath(home, FIXED_DATE);
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const rows = lines.map(line => JSON.parse(line));
    expect(rows.map(row => row.acId).sort()).toEqual(['ac1', 'ac2']);
    for (const row of rows) {
      expect(typeof row.keywordVerdict).toBe('string');
      expect(typeof row.jevNoul.observable).toBe('number');
      expect(typeof row.jevNoul.compound).toBe('number');
    }
  });

  it('never writes AC title text', async () => {
    const home = await tmpHome();
    const { fetch } = fakeFetch(() =>
      jsonResponse({
        model: 'test-model-x',
        answers: {
          observable_ac1: { type: 'noul', noul: 0.9 },
          compound_ac1: { type: 'noul', noul: 0.1 },
          observable_ac2: { type: 'noul', noul: 0.9 },
          compound_ac2: { type: 'noul', noul: 0.1 },
        },
        usage: { input_tokens: 40, output_tokens: 0 },
      }),
    );

    await reviewAcceptanceCriteria(doc([item()]), {
      config: config(),
      fetch,
      env: {},
      evalLogHome: home,
      now: () => FIXED_DATE,
    });

    const logPath = resolveAcceptanceCriteriaEvalLogPath(home, FIXED_DATE);
    const raw = await readFile(logPath, 'utf8');
    expect(raw).not.toContain(TITLE_MARKER);
  });

  it('writes nothing when the review is unavailable or failed', async () => {
    const unavailableHome = await tmpHome();
    const { fetch: unavailableFetch } = fakeFetch(() => jsonResponse({ error: 'unused' }));
    await reviewAcceptanceCriteria(doc([item()]), {
      config: config({ enabled: false }),
      fetch: unavailableFetch,
      env: {},
      evalLogHome: unavailableHome,
      now: () => FIXED_DATE,
    });
    await expect(readFile(resolveAcceptanceCriteriaEvalLogPath(unavailableHome, FIXED_DATE), 'utf8')).rejects.toThrow();

    const failedHome = await tmpHome();
    const { fetch: failedFetch } = fakeFetch(() => jsonResponse({ error: 'nope' }, 500));
    await reviewAcceptanceCriteria(doc([item()]), {
      config: config(),
      fetch: failedFetch,
      env: {},
      evalLogHome: failedHome,
      now: () => FIXED_DATE,
    });
    await expect(readFile(resolveAcceptanceCriteriaEvalLogPath(failedHome, FIXED_DATE), 'utf8')).rejects.toThrow();
  });

  it('returns issues even when the log write fails', async () => {
    const home = await tmpHome();
    const regularFile = join(home, 'not-a-directory');
    await writeFile(regularFile, 'x');
    const { fetch } = fakeFetch(() =>
      jsonResponse({
        model: 'test-model-x',
        answers: {
          observable_ac1: { type: 'noul', noul: 0.1 },
          compound_ac1: { type: 'noul', noul: 0.1 },
          observable_ac2: { type: 'noul', noul: 0.9 },
          compound_ac2: { type: 'noul', noul: 0.1 },
        },
        usage: { input_tokens: 40, output_tokens: 0 },
      }),
    );

    const result = await reviewAcceptanceCriteria(doc([item()]), {
      config: config(),
      fetch,
      env: {},
      evalLogHome: join(regularFile, 'jev-home'),
      now: () => FIXED_DATE,
    });

    expect(result.status).toBe('answered');
    if (result.status !== 'answered') throw new Error('unreachable');
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
