/**
 * PAN-5526: `pan plan done` no longer reads auto-start consent itself — the
 * complete-planning route reads the record. The POST body must never carry
 * an `autoSpawn` key, and reading the consent file for reporting purposes
 * must not touch it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const exits: number[] = [];
vi.mock('../../../src/cli/exit.js', () => ({
  exitCli: vi.fn(async (code: number) => {
    exits.push(code);
  }),
}));

import { planDoneCommand } from '../../../src/cli/commands/plan-done.js';
import { autoSpawnOnFinalizeFlagPath, writeAutoSpawnOnFinalizeFlag } from '../../../src/lib/planning/auto-spawn-consent.js';

const tmpDirs: string[] = [];
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  exits.length = 0;
  const overdeckHome = await mkdtemp(join(tmpdir(), 'plan-done-consent-home-'));
  tmpDirs.push(overdeckHome);
  vi.stubEnv('OVERDECK_HOME', overdeckHome);
  vi.stubEnv('OVERDECK_DASHBOARD_URL', 'http://127.0.0.1:3011');
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  consoleLogSpy.mockRestore();
  await Promise.all(tmpDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function lastRequestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const init = call[1] as { body?: string };
  return JSON.parse(init.body ?? '{}');
}

describe('plan-done consent (PAN-5526)', () => {
  it('sends no autoSpawn key and leaves the consent file untouched for a granted record', async () => {
    await writeAutoSpawnOnFinalizeFlag('PAN-9999', true);
    const consentPath = autoSpawnOnFinalizeFlagPath('PAN-9999');
    const before = await readFile(consentPath);

    await planDoneCommand('pan-9999');

    const body = lastRequestBody();
    expect(Object.keys(body)).not.toContain('autoSpawn');

    const after = await readFile(consentPath);
    expect(after.equals(before)).toBe(true);
    expect(exits).toEqual([]);
  });

  it('sends noPrd: true when --no-prd is passed', async () => {
    await planDoneCommand('pan-9999', { prd: false });

    const body = lastRequestBody();
    expect(body).toMatchObject({ noPrd: true });
    expect(Object.keys(body)).not.toContain('autoSpawn');
  });
});
