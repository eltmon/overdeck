/**
 * PAN-3917 W1: xBRIEF item status is written to and read from
 * `<planHome>/.pan/continues/<ISSUE>.xbrief.json` — never a record, never the
 * canonical spec. Lives apart from io.test.ts so the re-point is covered by a
 * suite that does not pull the tiered-execution modules.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWorkspacePlanSync, updateItemStatus, updateSubItemStatus, readWorkspacePlan } from '../../../../src/lib/xbrief/io.js';
import { Effect } from 'effect';

describe('io continue overlay', () => {
  it('writes and reads item status through the continue file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'io-smoke-'));
    const ws = join(root, 'workspaces', 'feature-pan-100');
    mkdirSync(ws, { recursive: true });
    const specsDir = join(root, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, '2026-01-01-PAN-100-t.xbrief.json'), JSON.stringify({
      status: 'active',
      xBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
      plan: { id: 'PAN-100', title: 't', status: 'active', items: [{ id: 'i1', title: 'i1', status: 'pending', subItems: [{ id: 'i1.a', title: 'a', status: 'pending' }] }], edges: [] },
    }));
    updateItemStatus(ws, 'i1', 'completed');
    updateSubItemStatus(ws, 'i1', 'a', 'completed');
    const file = JSON.parse(readFileSync(join(root, '.pan', 'continues', 'PAN-100.xbrief.json'), 'utf8'));
    expect(file.items).toEqual({ i1: { status: 'completed' }, 'i1.a': { status: 'completed' } });
    const doc = readWorkspacePlanSync(ws)!;
    expect(doc.plan.items[0].status).toBe('completed');
    expect(doc.plan.items[0].subItems![0].status).toBe('completed');
    const asyncDoc = await Effect.runPromise(readWorkspacePlan(ws));
    expect(asyncDoc!.plan.items[0].status).toBe('completed');
  });
});
