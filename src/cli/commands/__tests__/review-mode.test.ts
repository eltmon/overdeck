import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewModeCommand } from '../review-mode.js';

describe('reviewModeCommand', () => {
  let workspacePath: string;
  let originalCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalCwd = process.cwd();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-review-mode-'));
    process.chdir(workspacePath);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it("persists reviewMode='full' through the per-issue record write door", () => {
    reviewModeCommand('pan-1982', 'full');

    const recordPath = join(workspacePath, '.pan', 'records', 'pan-1982.json');
    const record = JSON.parse(readFileSync(recordPath, 'utf-8')) as { issueId: string; reviewMode?: string };

    expect(record.issueId).toBe('PAN-1982');
    expect(record.reviewMode).toBe('full');
  });

  it('rejects invalid review modes before writing a record', () => {
    expect(() => reviewModeCommand('PAN-1982', 'bogus')).toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('review mode must be quick or full'));
    expect(existsSync(join(workspacePath, '.pan', 'records', 'pan-1982.json'))).toBe(false);
  });
});
