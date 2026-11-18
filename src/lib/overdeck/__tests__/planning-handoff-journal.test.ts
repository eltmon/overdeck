import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readPipelineJournal } from '../../cloister/pipeline-journal.js';
import { journalHandoffRequest } from '../planning-handoff-journal.js';

describe('journalHandoffRequest (PAN-5498)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-5498-handoff-journal-'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns true and leaves handoff.requested on disk when the journal is writable', () => {
    const workspace = join(root, 'ws');
    mkdirSync(workspace);
    expect(journalHandoffRequest(workspace, 'pan-5498')).toBe(true);
    expect(readPipelineJournal(workspace).map((e) => e.type)).toEqual(['handoff.requested']);
  });

  it('returns false and warns when the journal write never reaches disk', () => {
    const workspace = join(root, 'ws');
    mkdirSync(workspace);
    // A file where the .overdeck directory should be makes the append fail; the
    // journal swallows that error, so only the readback can notice.
    writeFileSync(join(workspace, '.overdeck'), 'not a directory');
    expect(journalHandoffRequest(workspace, 'pan-5498')).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('did not reach the pipeline journal'));
  });

  it('returns false for a missing workspace', () => {
    expect(journalHandoffRequest(join(root, 'missing'), 'pan-5498')).toBe(false);
    expect(journalHandoffRequest(null, 'pan-5498')).toBe(false);
  });
});
