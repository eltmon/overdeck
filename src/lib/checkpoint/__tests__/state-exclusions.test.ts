import { describe, expect, it } from 'vitest';
import { STATE_BRANCH_PATHS } from '../../state-plane.js';
import { checkpointStateExclusions } from '../checkpoint-manager.js';

describe('checkpoint state exclusions', () => {
  it('excludes every state-branch domain plus workspace runtime files', () => {
    const exclusions = checkpointStateExclusions();
    for (const path of STATE_BRANCH_PATHS) {
      expect(exclusions).toContain(path === '.beads/' ? '.beads' : `.pan/${path.slice(0, -1)}`);
    }
    expect(exclusions).toContain('.overdeck');
  });
});
