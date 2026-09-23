import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FLYWHEEL_REPORT_RELATIVE_PATH,
  FLYWHEEL_STATE_RELATIVE_PATH,
  readFlywheelFile,
  readFlywheelReportFile,
  readFlywheelStateFile,
} from '../../../../src/lib/flywheel/files.js';

describe('flywheel plan-home files (PAN-3964 FR-3)', () => {
  let planHome: string;

  beforeEach(() => {
    planHome = mkdtempSync(join(tmpdir(), 'flywheel-files-'));
  });

  afterEach(() => {
    rmSync(planHome, { recursive: true, force: true });
  });

  it('reports a missing file as exists:false', async () => {
    expect(await readFlywheelStateFile(planHome)).toEqual({
      exists: false, path: FLYWHEEL_STATE_RELATIVE_PATH, content: null, lastModified: null,
    });
    expect((await readFlywheelReportFile(planHome)).exists).toBe(false);
  });

  it('returns content and an ISO lastModified for a present file', async () => {
    mkdirSync(join(planHome, '.pan', 'flywheel'), { recursive: true });
    writeFileSync(join(planHome, FLYWHEEL_STATE_RELATIVE_PATH), '# State\n\n- fixed PAN-1\n');
    writeFileSync(join(planHome, FLYWHEEL_REPORT_RELATIVE_PATH), '# Report\n');

    const state = await readFlywheelStateFile(planHome);
    expect(state.exists).toBe(true);
    expect(state.content).toContain('fixed PAN-1');
    expect(state.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect((await readFlywheelReportFile(planHome)).content).toBe('# Report\n');
  });

  it('throws when the path escapes the plan home', async () => {
    await expect(readFlywheelFile(planHome, '../outside.md')).rejects.toThrow(/escapes the plan home/);
    await expect(readFlywheelFile(planHome, '/etc/passwd')).rejects.toThrow(/escapes the plan home/);
  });
});
