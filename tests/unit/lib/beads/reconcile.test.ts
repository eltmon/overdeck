import { describe, expect, it } from 'vitest';

import { compareBeadsSources } from '../../../../src/lib/beads/reconcile.js';

describe('beads reconciliation inventory', () => {
  it('accounts for identical, one-sided, conflicting, and scope-excluded records', () => {
    const inventory = compareBeadsSources({
      'local-dolt': [
        { id: 'same', title: 'Same' },
        { id: 'local-only', title: 'Local' },
        { id: 'conflict', title: 'Local title' },
        { id: 'config', type: 'config', value: true },
      ],
      'remote-dolt': [
        { id: 'same', title: 'Same' },
        { id: 'remote-only', title: 'Remote' },
        { id: 'conflict', title: 'Remote title' },
        { id: 'config', type: 'config', value: true },
      ],
      'state-jsonl': [
        { id: 'same', title: 'Same' },
        { id: 'conflict', title: 'Older title' },
      ],
    });
    expect(Object.fromEntries(inventory.differences.map((row) => [row.id, row.classification]))).toEqual({
      config: 'outside-export-scope',
      conflict: 'conflicting',
      'local-only': 'one-sided',
      'remote-only': 'one-sided',
      same: 'identical',
    });
    expect(inventory.differences).toHaveLength(5);
  });
});
