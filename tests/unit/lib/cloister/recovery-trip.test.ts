import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acknowledgeRecoveryTrip, recordRecoveryFailure } from '../../../../src/lib/cloister/recovery-trip.js';
import { cleanupGitRecordRoot, initGitRecordRoot, removeGitRecordRemote } from '../../../helpers/git-record-fixture.js';

let workspace = '';
let remote: string | null = null;
afterEach(async () => {
  removeGitRecordRemote(remote);
  remote = null;
  if (workspace) await cleanupGitRecordRoot(workspace);
});

describe('PAN-2543 durable needs-you trip identity', () => {
  it('deduplicates across restart-shaped reads and allows a distinct later trip after acknowledgement', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-2543-trip-'));
    remote = initGitRecordRoot(workspace);
    expect((await recordRecoveryFailure(workspace, 'PAN-2543', 'swarm-slot-requeue', 'wi-8', 2)).emitNeedsYou).toBe(false);
    expect((await recordRecoveryFailure(workspace, 'PAN-2543', 'swarm-slot-requeue', 'wi-8', 2)).emitNeedsYou).toBe(true);
    expect((await recordRecoveryFailure(workspace, 'PAN-2543', 'swarm-slot-requeue', 'wi-8', 2)).emitNeedsYou).toBe(false);

    await acknowledgeRecoveryTrip(workspace, 'PAN-2543', 'swarm-slot-requeue', 'wi-8');
    expect((await recordRecoveryFailure(workspace, 'PAN-2543', 'swarm-slot-requeue', 'wi-8', 1)).emitNeedsYou).toBe(true);
    expect((await recordRecoveryFailure(workspace, 'PAN-2543', 'swarm-slot-requeue', 'wi-9', 1)).emitNeedsYou).toBe(true);
  });
});
