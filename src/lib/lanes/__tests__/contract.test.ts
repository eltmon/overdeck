/**
 * PAN-4223 WI-3 step 5: the lane contract text per role.
 */
import { describe, expect, it } from 'vitest';
import { LANE_ROLES } from '../../overdeck/conversations.js';
import { laneContract, type LaneContractInput } from '../contract.js';

function input(overrides: Partial<LaneContractInput>): LaneContractInput {
  return {
    role: 'builder',
    run: 'hotel',
    key: '663',
    iteration: 1,
    briefPath: '/home/u/.overdeck/agents/conv-brisk-otter/lane-brief.md',
    cwd: '/home/u/Projects/lexerra-lanes/hotel-663',
    branch: 'hotel/663',
    at: null,
    answering: null,
    ...overrides,
  };
}

const ROLE_MARKERS: Record<string, string> = {
  builder: 'Your branch is hotel/663.',
  critic: 'You judge commit',
  verifier: 'You judge commit',
  play: 'You are a cold player.',
  orchestrator: 'You run a cluster.',
};

describe('laneContract', () => {
  it.each(LANE_ROLES)('gives the %s role the common rules and its role block', (role) => {
    const text = laneContract(input({ role, at: role === 'critic' || role === 'verifier' ? 'abc1234' : null }));
    expect(text).toContain(`You are lane 663 (${role}, iteration 1) of gauntlet run hotel.`);
    expect(text).toContain('pan lane report --file');
    expect(text).toContain(ROLE_MARKERS[role]);
    for (const [other, marker] of Object.entries(ROLE_MARKERS)) {
      if (marker !== ROLE_MARKERS[role]) expect(text, `${role} must not carry the ${other} block`).not.toContain(marker);
    }
  });

  it('names the builder branch and the critic commit plus the verdict flags', () => {
    expect(laneContract(input({ branch: 'hotel/663-i2', iteration: 2 }))).toContain('Your branch is hotel/663-i2.');
    const critic = laneContract(input({ role: 'critic', branch: null, at: 'abc1234' }));
    expect(critic).toContain('You judge commit abc1234, checked out here.');
    expect(critic).toContain('--verdict ');
    expect(critic).toContain('--verdict-file');
  });

  it('adds the answering line only when a builder answers a verdict', () => {
    const answering = { criticId: 42, role: 'critic' as const, iteration: 1, verdict: 'NOT_YET', file: '/x/v.json' };
    const answered = laneContract(input({ iteration: 2, answering }));
    expect(answered).toContain('This iteration answers critic c1 (conv #42): NOT_YET. Verdict file: /x/v.json.');

    const verifier = laneContract(input({ answering: { ...answering, role: 'verifier', file: null } }));
    expect(verifier).toContain('answers verifier v1 (conv #42): NOT_YET. Verdict file: none recorded.');

    expect(laneContract(input({ answering: null }))).not.toContain('answers');
  });
});
