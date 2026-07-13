import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportBeadsJsonl } from '../../../../src/lib/beads/export.js';

describe('validated beads JSONL export', () => {
  const doltHead = 'dmqijeb6';
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  function fixture(records: Array<Record<string, unknown>>) {
    const root = mkdtempSync(join(tmpdir(), 'beads-export-'));
    roots.push(root);
    const beadsDir = join(root, '.beads');
    mkdirSync(beadsDir);
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args.join(' ') === 'vc status') return `Branch: main\nCommit: ${doltHead}\n`;
      if (args[0] === 'export') {
        const output = String(args[args.indexOf('-o') + 1]);
        writeFileSync(output, records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
        return '';
      }
      if (args[0] === 'list') return JSON.stringify(records);
      throw new Error(`unexpected: ${args.join(' ')}`);
    });
    return { root, beadsDir, execute };
  }

  it('exports and verifies the same --all record universe and records the source head', async () => {
    const f = fixture([{ id: 'one', title: 'One' }, { id: 'gate', type: 'gate' }]);
    const result = await exportBeadsJsonl(f.root, { beadsDir: f.beadsDir, execute: f.execute, now: () => new Date('2026-07-12T12:00:00Z') });
    expect(result.state).toEqual({ universe: 'all', sourceDoltHead: doltHead, recordCount: 2, exportedAt: '2026-07-12T12:00:00.000Z' });
    expect(f.execute).toHaveBeenCalledWith(expect.arrayContaining(['export', '--all']), f.root);
    expect(f.execute).toHaveBeenCalledWith(['list', '--all', '--json', '--limit', '0'], f.root);
  });

  it('refuses empty-over-nonempty and preserves the known-good snapshot', async () => {
    const f = fixture([]);
    const target = join(f.beadsDir, 'issues.jsonl');
    writeFileSync(target, '{"id":"known-good"}\n');
    await expect(exportBeadsJsonl(f.root, { beadsDir: f.beadsDir, execute: f.execute })).rejects.toThrow(/refused to replace/);
    expect(readFileSync(target, 'utf8')).toContain('known-good');
  });

  it('refuses an ID-set mismatch without publishing', async () => {
    const f = fixture([{ id: 'one' }]);
    f.execute.mockImplementation(async (args: readonly string[]) => {
      if (args.join(' ') === 'vc status') return `Commit: ${doltHead}\n`;
      if (args[0] === 'export') { writeFileSync(String(args.at(-1)), '{"id":"different"}\n'); return ''; }
      return JSON.stringify([{ id: 'one' }]);
    });
    await expect(exportBeadsJsonl(f.root, { beadsDir: f.beadsDir, execute: f.execute })).rejects.toThrow(/verification failed/);
  });
});
