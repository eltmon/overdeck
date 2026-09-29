import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { stampPlanForFinalization } from '../../../cli/commands/plan-finalize.js';
import { readPlanSync } from '../io.js';
import { planDigest } from '../plan-digest.js';
import type { XBriefDocument } from '../types.js';

function makeDoc(): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.8', created: '2026-09-29T00:00:00Z', updated: '2026-09-29T00:00:00Z' },
    plan: {
      id: 'PAN-9001',
      title: 'Digest fixture plan',
      status: 'draft',
      items: [
        { id: 'first', title: 'First item', status: 'pending' },
        { id: 'second', title: 'Second item', status: 'pending' },
      ],
      edges: [{ from: 'first', to: 'second', type: 'blocks' }],
      created: '2026-09-29T00:00:00Z',
      updated: '2026-09-29T00:00:00Z',
    },
  } as XBriefDocument;
}

describe('planDigest', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plan-digest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 64 lowercase hex characters', () => {
    expect(planDigest(makeDoc())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores object key order', () => {
    const doc = makeDoc();
    const reordered = {
      plan: {
        edges: doc.plan.edges,
        items: doc.plan.items.map((item) => ({ status: item.status, title: item.title, id: item.id })),
        updated: doc.plan.updated,
        created: doc.plan.created,
        status: doc.plan.status,
        title: doc.plan.title,
        id: doc.plan.id,
      },
      xBRIEFInfo: { updated: doc.xBRIEFInfo.updated, created: doc.xBRIEFInfo.created, version: doc.xBRIEFInfo.version },
    };
    expect(planDigest(reordered)).toBe(planDigest(doc));
  });

  it('changes when an item title changes', () => {
    const doc = makeDoc();
    const edited = makeDoc();
    edited.plan.items[0]!.title = 'First item, renamed';
    expect(planDigest(edited)).not.toBe(planDigest(doc));
  });

  it('is unchanged by stampPlanForFinalization', () => {
    const planPath = join(dir, 'spec.vbrief.json');
    writeFileSync(planPath, JSON.stringify(makeDoc(), null, 2), 'utf-8');
    const before = planDigest(readPlanSync(planPath));

    stampPlanForFinalization(planPath, 'PAN-9001');
    const stamped = readPlanSync(planPath);

    expect(stamped.plan.metadata?.canonicalFilename).toBeTruthy();
    expect(stamped.plan.sequence).toBe(1);
    expect(planDigest(stamped)).toBe(before);
  });
});
