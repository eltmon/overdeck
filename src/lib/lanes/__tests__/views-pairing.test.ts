/**
 * PAN-4223 WI-20: builder ↔ critic pairing on lane views. Real conversations
 * DB in a temp OVERDECK_HOME; enriched list, git facts and clock injected.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-views-pairing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

vi.mock('../../overdeck/conversation-list.js', () => ({ getEnrichedConversationList: vi.fn(async () => []) }));

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { archiveConversation, createConversation, getConversationByName } = await import('../../overdeck/conversations.js');
const { writeWorkerReport } = await import('../../agents/worker/report.js');
const { invalidateLaneViews, listLaneViews } = await import('../views.js');

const deps = { enrichedList: async () => [], gitFacts: async () => null, now: () => Date.now() };

function lane(name: string, parent: string, role: 'builder' | 'critic' | 'verifier', dir: string, criticOfName?: string) {
  createConversation({
    name,
    tmuxSession: `conv-${name}`,
    cwd: join(TEST_HOME, 'lanes', dir),
    workspaceId: null,
    parentName: parent,
    lane: { run: 'pair', key: '663', role, ...(criticOfName ? { criticOfName } : {}) },
  });
  return getConversationByName(name)!;
}

const verdict = (value: 'NOT_YET' | 'WOWED', defects: number | null = null) => ({ value, defects, file: `/v/${value}.json` });

beforeEach(() => invalidateLaneViews());

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('lane view pairing (PAN-4223 WI-20)', () => {
  it('pairs builders with critics oldest first, keeps archived critics, and names what i2 answers', async () => {
    createConversation({ name: 'pair-root', tmuxSession: 'conv-pair-root', cwd: TEST_HOME, workspaceId: null });
    const i1 = lane('pair-b1', 'pair-root', 'builder', 'pair-663');
    const c1 = lane('pair-c1', 'pair-root', 'critic', 'pair-663-critic-i1', 'pair-b1');
    const v1 = lane('pair-v1', 'pair-root', 'verifier', 'pair-663-verify-i1', 'pair-b1');
    await writeWorkerReport('conv-pair-c1', { body: 'x', verdict: verdict('NOT_YET', 4) });
    archiveConversation('pair-c1');
    const i2 = lane('pair-b2', 'pair-root', 'builder', 'pair-663-i2');

    const views = await listLaneViews({ run: 'pair' }, deps);
    const byName = Object.fromEntries(views.map((view) => [view.name, view]));

    expect(byName['pair-b1']?.critics.map((critic) => [critic.id, critic.role, critic.verdict, critic.defects])).toEqual([
      [c1.id, 'critic', 'NOT_YET', 4],
      [v1.id, 'verifier', 'pending', null],
    ]);
    expect(byName['pair-b1']?.latestVerdict?.id).toBe(v1.id);
    expect(byName['pair-c1']).toMatchObject({
      archived: true,
      criticOf: { id: i1.id, name: 'pair-b1', key: '663', iteration: 1 },
      verdict: { value: 'NOT_YET', defects: 4, file: '/v/NOT_YET.json' },
      critics: [],
    });
    expect(byName['pair-b2']).toMatchObject({ iteration: 2, critics: [], latestVerdict: null });
    expect(byName['pair-b2']?.answering).toMatchObject({ id: v1.id, role: 'verifier' });
    expect(byName['pair-b1']?.answering).toBeNull();
    expect(byName['pair-b1']?.verdict).toBeNull();
    expect(i2.id).toBeGreaterThan(i1.id);
  });
});
