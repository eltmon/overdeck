import { execFile } from 'child_process';
import { promisify } from 'util';
import { describe, expect, it } from 'vitest';
import { join } from 'path';

const execFileAsync = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli', 'index.js');

describe('pan done CLI options', () => {
  it('lists --test-waived in pan done --help (AC1)', async () => {
    const { stdout } = await execFileAsync('node', [CLI, 'done', '--help']);
    expect(stdout).toContain('--test-waived <reason>');
    expect(stdout).toContain('Skip the test-requirement gate');
  });

  it('rejects --test-waived without a reason (AC4)', async () => {
    await expect(execFileAsync('node', [CLI, 'done', 'PAN-1501', '--test-waived'])).rejects.toThrow(
      /error: option '--test-waived <reason>' argument missing/i,
    );
  });
});
