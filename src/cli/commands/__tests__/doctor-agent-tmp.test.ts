import { describe, expect, it } from 'vitest';

import { checkAgentTmp } from '../doctor-agent-tmp.js';

const ROOT = '/home/alice/.overdeck/tmp';

describe('checkAgentTmp', () => {
  it('reports ok "not created yet" when the root is absent', async () => {
    const results = await checkAgentTmp({ root: ROOT, exists: async () => false, measureBytes: async () => { throw new Error('must not be called'); } });
    expect(results).toEqual([{ name: `Agent scratch (${ROOT})`, status: 'ok', message: 'not created yet' }]);
  });

  it('reports ok with the size when at or below 10 GiB', async () => {
    const results = await checkAgentTmp({ root: ROOT, exists: async () => true, measureBytes: async () => 5 * 1024 ** 3 });
    expect(results).toEqual([{ name: `Agent scratch (${ROOT})`, status: 'ok', message: `5.0 GiB in ${ROOT}` }]);
  });

  it('reports warn with a fix when over 10 GiB', async () => {
    const results = await checkAgentTmp({ root: ROOT, exists: async () => true, measureBytes: async () => 12 * 1024 ** 3 });
    expect(results).toEqual([{
      name: `Agent scratch (${ROOT})`,
      status: 'warn',
      message: `12.0 GiB in ${ROOT} (over 10 GiB)`,
      fix: `The Deacon removes session directories idle for 14 days each hour; delete stale ones under ${ROOT}/claude-<uid>/ by hand if the disk is full`,
    }]);
  });

  it('reports warn when measuring throws', async () => {
    const results = await checkAgentTmp({ root: ROOT, exists: async () => true, measureBytes: async () => { throw new Error('du timed out'); } });
    expect(results).toEqual([{ name: `Agent scratch (${ROOT})`, status: 'warn', message: 'could not measure: du timed out' }]);
  });

  it('formats a size below 1 GiB in MiB', async () => {
    const results = await checkAgentTmp({ root: ROOT, exists: async () => true, measureBytes: async () => 512 * 1024 ** 2 });
    expect(results[0]).toMatchObject({ status: 'ok', message: `512 MiB in ${ROOT}` });
  });
});
