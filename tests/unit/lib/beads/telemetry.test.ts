import { describe, expect, it } from 'vitest';

import { getBeadsHealth, recordBeadsConflict, recordBeadsPull, recordBeadsPush } from '../../../../src/lib/beads/telemetry.js';

describe('beads telemetry', () => {
  it('exposes heads, pull/push times, conflicts, schema, and migrator status', async () => {
    recordBeadsPull('fixture', 'local-a', 'remote-a', new Date('2026-07-12T10:00:00Z'));
    recordBeadsPush('fixture', 'local-b', new Date('2026-07-12T10:01:00Z'));
    recordBeadsConflict('fixture', 'same-row conflict requires reconciliation');
    const previous = process.env.BD_ALLOW_REMOTE_MIGRATE;
    process.env.BD_ALLOW_REMOTE_MIGRATE = '1';
    try {
      const result = await getBeadsHealth('fixture', '/tmp', async () => JSON.stringify({ schema_version: 53 }));
      expect(result).toMatchObject({
        localHead: 'local-b',
        lastPulledRemoteHead: 'remote-a',
        lastSuccessfulPullAt: '2026-07-12T10:00:00.000Z',
        lastSuccessfulPushAt: '2026-07-12T10:01:00.000Z',
        lastConflict: 'same-row conflict requires reconciliation',
        schemaVersion: 53,
        designatedMigrator: true,
      });
    } finally {
      if (previous === undefined) delete process.env.BD_ALLOW_REMOTE_MIGRATE;
      else process.env.BD_ALLOW_REMOTE_MIGRATE = previous;
    }
  });
});
