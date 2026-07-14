import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';

import { buildClassifyLookups } from '../lookups.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PAN-2640 classify-lookups no-loss audit', () => {
  it('requires every compiled caller to supply the bulk presence snapshot', () => {
    expectTypeOf(buildClassifyLookups).parameter(1).toMatchTypeOf<{
      issuesWithTasks: ReadonlySet<string>;
      labels?: (id: string) => readonly string[];
    }>();
  });

  it('derives planned state only from the supplied bulk snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-2640-lookups-'));
    roots.push(root);
    mkdirSync(join(root, '.pan', 'specs'), { recursive: true });
    writeFileSync(join(root, '.pan', 'specs', '1-PAN-2640-plan.json'), '{}');

    const absent = buildClassifyLookups(root, { issuesWithTasks: new Set() });
    const present = buildClassifyLookups(root, { issuesWithTasks: new Set(['PAN-2640']) });

    expect(absent.isPlanned('PAN-2640')).toBe(false);
    expect(present.isPlanned('PAN-2640')).toBe(true);
  });
});
