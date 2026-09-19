import { describe, expect, it } from 'vitest';
import { PAN_RUNTIME_SUBDIRS } from '../../state-plane.js';
import { checkpointStateExclusions } from '../checkpoint-manager.js';

describe('checkpoint state exclusions', () => {
  it('excludes every state-branch domain plus workspace runtime files', () => {
    const exclusions = checkpointStateExclusions();
    for (const path of PAN_RUNTIME_SUBDIRS) {
      expect(exclusions).toContain(path === '.tasks/' ? '.tasks' : `.pan/${path.slice(0, -1)}`);
    }
    expect(exclusions).toContain('.overdeck');
  });
});
