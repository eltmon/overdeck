import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auto-commit.js', () => ({ queueAutoCommit: vi.fn() }));
import { applyTaskStatusChange } from '../task-door.js';

let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('immutable task specification', () => {
  it('keeps the vBRIEF byte-identical across claim and completion', async () => {
    root = mkdtempSync(join(tmpdir(), 'task-no-spec-write-'));
    const project = { name: 'no-spec-write', path: root };
    const dir = join(root, '.pan', 'specs');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, '2026-07-14-DOOR-200-immutable.vbrief.json');
    writeFileSync(path, JSON.stringify({ status: 'active', vBRIEFInfo: { version: '1', created: '2026-07-14T00:00:00Z' }, plan: { id: 'DOOR-200', title: 'Immutable', status: 'active', items: [{ id: 'wi-1', title: 'One', status: 'pending' }], edges: [] } }));
    const before = readFileSync(path);
    await applyTaskStatusChange(project, 'DOOR-200', { type: 'claim', itemId: 'wi-1', writerId: 'agent-a' });
    await applyTaskStatusChange(project, 'DOOR-200', { type: 'done', itemId: 'wi-1', writerId: 'agent-a' });
    expect(readFileSync(path)).toEqual(before);
  });
});
