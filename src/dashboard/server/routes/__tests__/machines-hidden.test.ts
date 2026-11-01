/** PAN-4650 WI-13: PATCH /api/machines/:id { hidden } persists Hide this machine and GET /api/machines reports it. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetLinkStoreForTests, _settleLinkStoreWritesForTests, upsertLink } = await import('../../../../lib/anywhere/link-store.js');
const { buildMachinesResponse, handleSetHidden, handleSetSharing } = await import('../machines.js');
const { buildSharedConversations } = await import('../../../../lib/anywhere/shared-conversations.js');

const originalHome = process.env.OVERDECK_HOME;
let home: string;

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: Record<string, unknown> }> {
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

async function storedLinks(): Promise<Array<Record<string, unknown>>> {
  return (JSON.parse(await readFile(join(home, 'machine-links.json'), 'utf8')) as { links: Array<Record<string, unknown>> }).links;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4650-hidden-'));
  process.env.OVERDECK_HOME = home;
  _resetLinkStoreForTests();
  await upsertLink({ environmentId: 'env-desk', label: 'desk', machineKey: 'ab'.repeat(32), token: `odk_${'1'.repeat(64)}`, access: 'operator', routes: [] });
});

afterEach(async () => {
  await _settleLinkStoreWritesForTests();
  _resetLinkStoreForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('Hide this machine (PAN-4650 WI-13)', () => {
  it('ac3: { hidden: true } persists and GET /api/machines reports it; { hidden: false } clears it', async () => {
    const hid = await read(await handleSetHidden('desk', JSON.stringify({ hidden: true })));
    expect(hid.status).toBe(200);
    expect(hid.json).toMatchObject({ label: 'desk', hidden: true });
    expect((await storedLinks())[0]).toMatchObject({ hidden: true });
    const listed = (await buildMachinesResponse()) as { links: Array<{ label: string; hidden: boolean }> };
    expect(listed.links).toEqual([expect.objectContaining({ label: 'desk', hidden: true })]);

    const shown = await read(await handleSetHidden('env-desk', JSON.stringify({ hidden: false })));
    expect(shown.json).toMatchObject({ hidden: false });
    expect((await storedLinks())[0]).not.toHaveProperty('hidden');
  });

  it('answers 404 for an unknown machine and 400 for a body without a boolean', async () => {
    expect((await read(await handleSetHidden('nowhere', '{"hidden":true}'))).status).toBe(404);
    expect((await read(await handleSetHidden('desk', '{"hidden":"yes"}'))).status).toBe(400);
    expect((await read(await handleSetHidden('desk', 'not json'))).status).toBe(400);
  });

  it('PAN-4650 WI-15 ac3: PUT sharing writes anywhere.json; the machines view and the shared list follow it', async () => {
    expect(((await buildMachinesResponse()) as { self: { shareConversations: boolean } }).self.shareConversations).toBe(true);
    const turnedOff = await read(await handleSetSharing(JSON.stringify({ conversations: false })));
    // PAN-4651 D-4651-13: the answer and the file carry the Combine switch too (default on).
    expect(turnedOff).toEqual({ status: 200, json: { conversations: false, combineRepositories: true } });
    expect(JSON.parse(await readFile(join(home, 'anywhere.json'), 'utf8'))).toEqual({ v: 1, shareConversations: false, combineRepositories: true });
    expect(((await buildMachinesResponse()) as { self: { shareConversations: boolean } }).self.shareConversations).toBe(false);
    const shared = await buildSharedConversations({ environmentId: async () => 'env-self', listRows: async () => [] });
    expect(shared).toMatchObject({ sharing: false, rows: [], hash: 'sharing-off' });
    expect((await read(await handleSetSharing('{"conversations":"no"}'))).status).toBe(400);
  });
});
