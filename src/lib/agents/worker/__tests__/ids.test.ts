import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isValidAgentDirectoryName } from '../../../agent-directory-cleanup.js';
import { runAgentId } from '../../spawn-prep.js';
import { WORKER_ID_RE, allocateWorkerId, workerNumber } from '../ids.js';

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'worker-ids-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('allocateWorkerId (PAN-3920 D12)', () => {
  it('starts at worker-1 and claims the directory', async () => {
    const id = await allocateWorkerId('PAN-9');
    expect(id).toBe('agent-pan-9-worker-1');
    expect(WORKER_ID_RE.test(id)).toBe(true);
    expect(workerNumber(id)).toBe(1);
    // The same id the role-run naming produces, so resume/restart find it.
    expect(runAgentId('PAN-9', 'worker', '1')).toBe(id);
  });

  it('continues after the highest existing worker', async () => {
    mkdirSync(join(home, 'agents', 'agent-pan-9-worker-1'), { recursive: true });
    mkdirSync(join(home, 'agents', 'agent-pan-9-worker-2'), { recursive: true });
    mkdirSync(join(home, 'agents', 'agent-pan-90-worker-7'), { recursive: true });
    expect(await allocateWorkerId('PAN-9')).toBe('agent-pan-9-worker-3');
  });

  it('gives two concurrent callers different ids', async () => {
    const [a, b] = await Promise.all([allocateWorkerId('PAN-9'), allocateWorkerId('PAN-9')]);
    expect(a).not.toBe(b);
    expect([a, b].sort()).toEqual(['agent-pan-9-worker-1', 'agent-pan-9-worker-2']);
  });

  it('produces a name pan sync cleanup keeps', async () => {
    expect(isValidAgentDirectoryName(await allocateWorkerId('PAN-3920'))).toBe(true);
  });
});
