/** PAN-4651 WI-7 (D-4651-9): the Auto placement rule, table-driven. */
import type { LoadSample } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import { choosePlacement, noMachineFits, type PlacementCandidate, placementReason } from '../placement.js';

const GIB = 2 ** 30;
const load = (cpu: number | null, gib: number | null, agents: number, saturated = false): LoadSample => ({
  cpuPsiSomeAvg10: cpu, cpuSaturated: saturated, memAvailableBytes: gib === null ? null : gib * GIB, workingAgents: agents, sampledAt: '2026-11-01T12:00:00.000Z',
});

function machine(label: string, overrides: Partial<PlacementCandidate> = {}): PlacementCandidate {
  return {
    environmentId: `env-${label}`, label, self: false, state: 'online', load: load(10, 16, 1), tags: ['linux'],
    placement: 'auto', projectOrigins: ['github.com/eltmon/overdeck'], ...overrides,
  };
}

const laptop = (overrides: Partial<PlacementCandidate> = {}) => machine('laptop', { self: true, ...overrides });

describe('choosePlacement (D-4651-9)', () => {
  it('saturated desk + free laptop ⇒ laptop, with the reason string', () => {
    const answer = choosePlacement({
      candidates: [laptop({ load: load(3.4, 41.7, 2) }), machine('desk', { load: load(1, 64, 0, true) })],
      gitOrigin: null, needs: [],
    });
    expect(answer).toEqual({
      ok: true, environmentId: 'env-laptop', label: 'laptop', self: true,
      reason: 'Auto → laptop (CPU pressure 3%, 41 GB free, 2 agents)',
      rejections: [{ environmentId: 'env-desk', label: 'desk', reason: 'CPU saturated' }],
    });
  });

  it("needs ['docker'] and only desk has docker ⇒ desk", () => {
    const answer = choosePlacement({ candidates: [laptop(), machine('desk', { tags: ['docker', 'linux'], load: load(50, 2, 9) })], gitOrigin: null, needs: ['docker'] });
    expect(answer).toMatchObject({ ok: true, label: 'desk', rejections: [{ label: 'laptop', reason: 'no docker' }] });
  });

  it('reserved desk + eligible laptop ⇒ laptop', () => {
    const answer = choosePlacement({ candidates: [laptop({ load: load(40, 4, 5) }), machine('desk', { placement: 'on-request', load: load(0, 64, 0) })], gitOrigin: null, needs: [] });
    expect(answer).toMatchObject({ ok: true, label: 'laptop', rejections: [{ label: 'desk', reason: 'reserved' }] });
  });

  it('a reserved desk that is the only machine with gpu ⇒ desk', () => {
    const answer = choosePlacement({ candidates: [laptop(), machine('desk', { placement: 'on-request', tags: ['gpu', 'linux'] })], gitOrigin: null, needs: ['gpu'] });
    expect(answer).toMatchObject({ ok: true, label: 'desk', rejections: [{ label: 'laptop', reason: 'no gpu' }] });
  });

  it('a reserved machine stays reserved when a non-reserved machine failed for another reason', () => {
    const answer = choosePlacement({
      candidates: [laptop(), machine('desk', { placement: 'on-request', tags: ['gpu'] }), machine('lab', { state: 'offline' })],
      gitOrigin: null, needs: ['gpu'],
    });
    expect(answer).toEqual({ ok: false, rejections: [
      { environmentId: 'env-laptop', label: 'laptop', reason: 'no gpu' },
      { environmentId: 'env-desk', label: 'desk', reason: 'reserved' },
      { environmentId: 'env-lab', label: 'lab', reason: 'offline' },
    ] });
  });

  it('no candidates ⇒ ok: false with one reason per machine, in order', () => {
    const answer = choosePlacement({
      candidates: [
        laptop({ tags: ['linux'] }),
        machine('desk', { state: 'offline' }),
        machine('old', { state: 'unsupported' }),
        machine('web', { projectOrigins: ['gitlab.com/acme/web'] }),
      ],
      gitOrigin: 'github.com/eltmon/overdeck', needs: ['docker'],
    });
    expect(answer.ok).toBe(false);
    expect(answer.rejections.map((r) => `${r.label}: ${r.reason}`)).toEqual(['laptop: no docker', 'desk: offline', 'old: unsupported', 'web: no project']);
    expect(noMachineFits(answer.rejections)).toBe('No machine fits: laptop: no docker; desk: offline; old: unsupported; web: no project');
  });

  it('matches the project slug ignoring case', () => {
    const answer = choosePlacement({ candidates: [laptop({ projectOrigins: [] }), machine('desk', { projectOrigins: ['github.com/Eltmon/Overdeck'] })], gitOrigin: 'github.com/eltmon/overdeck', needs: [] });
    expect(answer).toMatchObject({ ok: true, label: 'desk', rejections: [{ label: 'laptop', reason: 'no project' }] });
  });

  it('equal loads ⇒ more memory wins, then fewer agents, then self, then label', () => {
    const pick = (...candidates: PlacementCandidate[]) => (choosePlacement({ candidates, gitOrigin: null, needs: [] }) as { label: string }).label;
    expect(pick(laptop({ load: load(5, 8, 1) }), machine('desk', { load: load(5, 32, 1) }))).toBe('desk');
    expect(pick(laptop({ load: load(5, 32, 3) }), machine('desk', { load: load(5, 32, 1) }))).toBe('desk');
    expect(pick(machine('desk', { load: load(5, 32, 1) }), laptop({ load: load(5, 32, 1) }))).toBe('laptop');
    expect(pick(machine('zed', { load: load(5, 32, 1) }), machine('ant', { load: load(5, 32, 1) }))).toBe('ant');
    expect(pick(machine('desk', { load: null }), machine('lab', { load: load(90, 1, 9) }))).toBe('lab');
  });

  it('same inputs twice ⇒ same answer', () => {
    const input = { candidates: [laptop({ load: load(5, 8, 1) }), machine('desk', { load: load(5, 8, 1) }), machine('lab', { load: load(5, 8, 1) })], gitOrigin: null, needs: [] };
    expect(choosePlacement(input)).toEqual(choosePlacement(input));
  });

  it('prints n/a for unknown load values', () => {
    expect(placementReason(machine('desk', { load: null }))).toBe('Auto → desk (CPU pressure n/a, n/a GB free, n/a agents)');
    expect(placementReason(machine('mac', { load: load(null, null, 0) }))).toBe('Auto → mac (CPU pressure n/a, n/a GB free, 0 agents)');
  });
});
