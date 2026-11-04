/** PAN-4651 WI-16 (D-4651-13): projects grouped by git origin across machines, and the sharing switches. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readAnywhereSettings } from '../../../lib/anywhere/anywhere-settings.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { buildFleetProjects, type FleetProjectsDeps } from '../routes/fleet-projects.js';
import { handleSetSharing } from '../routes/machines.js';
import { readJsonResponse } from '../routes/machines-work.js';

const link = (label: string, extra: Partial<MachineLink> = {}) => ({ id: `link-${label}`, environmentId: `env-${label}`, label, revokedAt: null, ...extra }) as MachineLink;

function deps(overrides: Partial<FleetProjectsDeps> = {}): FleetProjectsDeps {
  const remote: Record<string, Array<{ key: string; name: string; gitOrigin: string | null }>> = {
    'env-desk': [
      { key: 'od', name: 'Overdeck', gitOrigin: 'github.com/Eltmon/Overdeck' },
      { key: 'billing', name: 'Billing', gitOrigin: 'github.com/acme/billing' },
      { key: 'notes', name: 'Notes', gitOrigin: null },
    ],
    'env-hid': [{ key: 'secret', name: 'Secret', gitOrigin: 'github.com/acme/secret' }],
  };
  return {
    combine: async () => true,
    localProjects: async () => [
      { key: 'overdeck', name: 'Overdeck', gitOrigin: 'github.com/eltmon/overdeck' },
      { key: 'scratch', name: 'Scratch', gitOrigin: null },
    ],
    links: async () => [link('desk'), link('hid', { hidden: true })],
    status: (() => ({ state: 'online' })) as unknown as FleetProjectsDeps['status'],
    linkedProjects: (environmentId) => remote[environmentId] ?? null,
    ...overrides,
  };
}

describe('GET /api/fleet/projects (D-4651-13)', () => {
  it('ac16: groups two machines\' overdeck under one slug and lists a desk-only project with local: null', async () => {
    const answer = await buildFleetProjects(deps());
    expect(answer).toEqual({
      combine: true,
      projects: [
        { gitOrigin: 'github.com/eltmon/overdeck', name: 'Overdeck', local: { key: 'overdeck' }, machines: [{ environmentId: 'env-desk', label: 'desk', key: 'od', state: 'online' }] },
        { gitOrigin: null, name: 'Scratch', local: { key: 'scratch' }, machines: [] },
        { gitOrigin: 'github.com/acme/billing', name: 'Billing', local: null, machines: [{ environmentId: 'env-desk', label: 'desk', key: 'billing', state: 'online' }] },
      ],
    });
  });

  it('reports the combine switch', async () => {
    expect((await buildFleetProjects(deps({ combine: async () => false }))).combine).toBe(false);
  });
});

describe('PUT /api/machines/sharing (D-4651-13)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-4651-sharing-'));
    process.env.OVERDECK_HOME = home;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('takes either switch alone, defaults combine on, and refuses an empty body', async () => {
    expect((await readAnywhereSettings()).combineRepositories).toBe(true);
    expect(readJsonResponse(await handleSetSharing(JSON.stringify({ combineRepositories: false })))).toEqual({ status: 200, body: { conversations: true, combineRepositories: false } });
    expect(readJsonResponse(await handleSetSharing(JSON.stringify({ conversations: false })))).toEqual({ status: 200, body: { conversations: false, combineRepositories: false } });
    expect(readJsonResponse(await handleSetSharing('{}')).status).toBe(400);
    expect(readJsonResponse(await handleSetSharing(JSON.stringify({ combineRepositories: 'yes' }))).status).toBe(400);
  });
});
