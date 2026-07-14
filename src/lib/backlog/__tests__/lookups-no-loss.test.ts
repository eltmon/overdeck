import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildClassifyLookups } from '../lookups.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PAN-2640 classify-lookups no-loss audit', () => {
  it('derives planned state from the durable plan specification', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-2640-lookups-'));
    roots.push(root);
    mkdirSync(join(root, '.pan', 'specs'), { recursive: true });
    writeFileSync(join(root, '.pan', 'specs', '1-PAN-2640-plan.json'), '{}');

    const lookups = buildClassifyLookups(root);

    expect(lookups.isPlanned('PAN-2640')).toBe(true);
    expect(lookups.isPlanned('PAN-2641')).toBe(false);
  });
});
