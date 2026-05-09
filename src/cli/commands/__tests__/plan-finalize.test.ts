import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { stampPlanForFinalization } from '../plan-finalize.js';
import type { VBriefDocument } from '../../../lib/vbrief/types.js';

let TEST_DIR: string;

function makePlanDoc(overrides: Partial<VBriefDocument['plan']> = {}): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-03T00:00:00Z' },
    plan: {
      id: 'pan-946',
      title: 'Adopt deft vBRIEF Lifecycle Model',
      status: 'draft',
      sequence: 3,
      created: '2026-05-03T00:00:00Z',
      items: [],
      edges: [],
      ...overrides,
    },
  };
}

function writePlan(path: string, doc: VBriefDocument): void {
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf-8');
}

function readDoc(path: string): VBriefDocument {
  return JSON.parse(readFileSync(path, 'utf-8')) as VBriefDocument;
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'plan-finalize-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('stampPlanForFinalization', () => {
  it('sets plan.status to "proposed"', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ status: 'draft' }));
    stampPlanForFinalization(path, 'PAN-946');
    expect(readDoc(path).plan.status).toBe('proposed');
  });

  it('generates and stamps a canonical filename derived from title + issueId', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ title: 'Adopt deft vBRIEF Lifecycle' }));
    const filename = stampPlanForFinalization(path, 'PAN-946');
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-PAN-946-adopt-deft-vbrief-lifecycle\.vbrief\.json$/);
    const after = readDoc(path);
    expect(after.plan.metadata?.canonicalFilename).toBe(filename);
  });

  it('falls back to plan.id when title is empty', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ title: '', id: 'pan-946' }));
    const filename = stampPlanForFinalization(path, 'PAN-946');
    expect(filename).toMatch(/PAN-946-pan-946\.vbrief\.json$/);
  });

  it('falls back to issueId when title and id are both empty', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ title: '', id: '' }));
    const filename = stampPlanForFinalization(path, 'PAN-946');
    // slugify('PAN-946') -> 'pan-946'
    expect(filename).toMatch(/PAN-946-pan-946\.vbrief\.json$/);
  });

  it('preserves an existing canonicalFilename (idempotent date)', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    const existing = '2026-04-01-PAN-946-original-slug.vbrief.json';
    writePlan(
      path,
      makePlanDoc({
        metadata: { canonicalFilename: existing },
        title: 'A New Title That Should Not Change The Filename',
      }),
    );
    const filename = stampPlanForFinalization(path, 'PAN-946');
    expect(filename).toBe(existing);
    expect(readDoc(path).plan.metadata?.canonicalFilename).toBe(existing);
  });

  it('increments plan.sequence and refreshes timestamps', async () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc({ sequence: 5 }));
    await new Promise((r) => setTimeout(r, 5));
    stampPlanForFinalization(path, 'PAN-946');
    const after = readDoc(path);
    expect(after.plan.sequence).toBe(6);
    expect(after.plan.updated).toBeTruthy();
    expect(after.plan.updated).not.toBe('2026-05-03T00:00:00Z');
    expect(after.vBRIEFInfo.updated).toBeTruthy();
  });

  it('writes atomically (no .tmp left behind)', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(path, makePlanDoc());
    stampPlanForFinalization(path, 'PAN-946');
    expect(existsSync(path + '.tmp')).toBe(false);
  });

  it('preserves other metadata fields when stamping canonicalFilename', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    writePlan(
      path,
      makePlanDoc({
        metadata: { someOtherField: 'kept', anotherKey: 42 },
      }),
    );
    stampPlanForFinalization(path, 'PAN-946');
    const after = readDoc(path);
    expect(after.plan.metadata?.someOtherField).toBe('kept');
    expect(after.plan.metadata?.anotherKey).toBe(42);
    expect(after.plan.metadata?.canonicalFilename).toMatch(/^\d{4}-\d{2}-\d{2}-PAN-946-/);
  });

  it('initializes sequence to 1 when previously missing', () => {
    const path = join(TEST_DIR, 'spec.vbrief.json');
    const doc = makePlanDoc();
    delete (doc.plan as Partial<typeof doc.plan>).sequence;
    writePlan(path, doc);
    stampPlanForFinalization(path, 'PAN-946');
    expect(readDoc(path).plan.sequence).toBe(1);
  });
});
