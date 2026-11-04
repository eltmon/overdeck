/**
 * PAN-5005: `laneFieldsByRun` pairs lane list fields (report, iteration,
 * verdict) over local and remote lanes of a run, so a remote critic's
 * verdict reaches a home builder and vice versa. Real conversations DB and
 * stand-in store in a temp OVERDECK_HOME, real reports.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-list-fields-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation } = await import('../../overdeck/conversations.js');
const { writeWorkerReport } = await import('../../agents/worker/report.js');
const { writeRemoteLaneFacts, writeCriticLink } = await import('../remote-lanes.js');
const { laneFieldsByRun } = await import('../lane-list-fields.js');

type Facts = import('../remote-lanes.js').RemoteLaneFacts;

function root(name: string): void {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: TEST_HOME, workspaceId: null });
}

function facts(overrides: Partial<Facts> & { name: string; parentName: string; run: string }): Facts {
  return {
    v: 1, environmentId: 'env-fly', label: 'fly-abc', key: '663', role: 'critic', iteration: 1,
    criticOfName: null, projectKey: 'lexerra', cwd: `/workspace/lanes/${overrides.name}`, branch: null, at: 'abc1234',
    model: 'claude-opus-5-5', harness: 'claude-code', effort: 'high', title: `${overrides.name}`,
    createdAt: new Date(Date.now() + 1_000).toISOString(),
    ...overrides,
  };
}

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('laneFieldsByRun (PAN-5005)', () => {
  beforeEach(() => {});

  it('ac1: a remote critic gives a home builder its verdict', async () => {
    root('hm-root');
    createConversation({
      name: 'b1', tmuxSession: 'conv-b1', cwd: join(TEST_HOME, 'lanes', 'b1'), workspaceId: null,
      parentName: 'hm-root', lane: { run: 'hotel', key: '663', role: 'builder' },
    });
    await writeRemoteLaneFacts(facts({ name: 'c-fly', parentName: 'hm-root', run: 'hotel', criticOfName: 'b1' }));
    await writeWorkerReport('conv-c-fly', { body: 'passed', status: 'done', verdict: { value: 'PASS', defects: 0, file: null } });

    const result = await laneFieldsByRun(['hotel']);

    expect(result.get('b1')?.laneLatestVerdict).toEqual({ value: 'PASS', defects: 0, criticId: null, criticRoute: '@env-fly/c-fly' });
    expect(result.get('c-fly')?.laneReport?.status).toBe('done');
    expect(result.get('c-fly')?.laneVerdict).toEqual({ value: 'PASS', defects: 0 });
  });

  it('ac2: a home critic of a remote builder pairs through lane-link.json', async () => {
    root('hc-root');
    await writeRemoteLaneFacts(facts({ name: 'b-fly', parentName: 'hc-root', run: 'hc', role: 'builder' }));
    const c1 = createConversation({
      name: 'c1', tmuxSession: 'conv-c1', cwd: join(TEST_HOME, 'lanes', 'c1'), workspaceId: null,
      parentName: 'hc-root', lane: { run: 'hc', key: '663', role: 'critic' },
    });
    await writeCriticLink('c1', 'b-fly');

    const result = await laneFieldsByRun(['hc']);

    const latest = result.get('b-fly')?.laneLatestVerdict;
    expect(latest?.criticId).toBe(c1.id);
    expect(latest?.criticRoute).toBe(String(c1.id));
  });

  it('ac3: a remote play lane carries its report with no verdict fields', async () => {
    root('play-root');
    await writeRemoteLaneFacts(facts({ name: 'play-fly', parentName: 'play-root', run: 'play-run', role: 'play' }));
    await writeWorkerReport('conv-play-fly', { body: 'played', status: 'done' });

    const result = await laneFieldsByRun(['play-run']);

    const entry = result.get('play-fly');
    expect(entry?.laneReport?.status).toBe('done');
    expect(entry).not.toHaveProperty('laneVerdict');
    expect(entry).not.toHaveProperty('laneLatestVerdict');
  });

  it('ac3: no runs resolves to an empty map', async () => {
    const result = await laneFieldsByRun([]);
    expect(result.size).toBe(0);
  });
});
