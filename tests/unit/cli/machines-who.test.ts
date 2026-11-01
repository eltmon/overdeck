/** PAN-4651 WI-22 (D-4651-16): `pan machines who <issue>`. */
import { describe, expect, it } from 'vitest';

import { runMachinesWho } from '../../../src/cli/commands/machines-who.js';

const ANSWER = { machines: [
  { environmentId: 'env-laptop', label: 'laptop', self: true, agents: [], conversations: [{ name: 'conv-a', isWorking: true }] },
  { environmentId: 'env-desk', label: 'desk', self: false, agents: [{ id: 'agent-pan-7', status: 'running' }], conversations: [] },
  { environmentId: 'env-lab', label: 'lab', self: false, agents: [], conversations: [], error: 'did not answer within 2.5 s' },
] };

function deps() {
  const out: string[] = [];
  const err: string[] = [];
  const paths: string[] = [];
  return {
    out, err, paths,
    value: {
      call: async (path: string) => { paths.push(path); return { status: 200, json: ANSWER }; },
      stdout: (text: string) => { out.push(text); },
      stderr: (text: string) => { err.push(text); },
    },
  };
}

describe('pan machines who (PAN-4651 WI-22)', () => {
  it('ac22: prints one row per agent and conversation, labelled by machine', async () => {
    const d = deps();
    expect(await runMachinesWho('pan-7', {}, d.value)).toBe(0);
    expect(d.paths).toEqual(['/api/fleet/issues/PAN-7/activity']);
    expect(d.out[0]).toMatch(/^MACHINE\s+KIND\s+ID\s+STATUS$/);
    expect(d.out.slice(1)).toEqual([
      expect.stringMatching(/^laptop\s+conversation\s+conv-a\s+working$/),
      expect.stringMatching(/^desk\s+agent\s+agent-pan-7\s+running$/),
    ]);
    expect(d.err).toEqual(['lab: did not answer within 2.5 s']);
  });

  it('ac22: --json prints the fleet route answer', async () => {
    const d = deps();
    expect(await runMachinesWho('PAN-7', { json: true }, d.value)).toBe(0);
    expect(JSON.parse(d.out[0]!)).toEqual(ANSWER);
  });
});
