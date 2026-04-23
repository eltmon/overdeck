import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = join(process.cwd(), 'scripts', 'check-no-direct-label-writes.sh');

describe('check-no-direct-label-writes.sh', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pan-label-check-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('passes when no violations exist', async () => {
    const { stdout, stderr } = await execFileAsync('bash', [SCRIPT_PATH, tempDir]);
    expect(stdout).toContain('OK: No direct label write violations found');
    expect(stderr).toBe('');
  });

  it('fails when a stray gh issue edit --add-label is found', async () => {
    const fixture = join(tempDir, 'bad-file.ts');
    await writeFile(fixture, `await execAsync('gh issue edit 42 --repo owner/repo --add-label "in-progress"');`);

    try {
      await execFileAsync('bash', [SCRIPT_PATH, tempDir]);
      expect.fail('Expected script to throw');
    } catch (err: any) {
      expect(err.stderr || err.stdout || err.message).toContain('Direct label writes found outside reconciler');
    }
  });

  it('fails when a stray gh issue edit --remove-label is found', async () => {
    const fixture = join(tempDir, 'bad-file.ts');
    await writeFile(fixture, `await execAsync('gh issue edit 42 --repo owner/repo --remove-label "in-review"');`);

    try {
      await execFileAsync('bash', [SCRIPT_PATH, tempDir]);
      expect.fail('Expected script to throw');
    } catch (err: any) {
      expect(err.stderr || err.stdout || err.message).toContain('Direct label writes found outside reconciler');
    }
  });

  it('ignores lines annotated with PAN-805-exempt', async () => {
    const fixture = join(tempDir, 'exempt-file.ts');
    await writeFile(
      fixture,
      `await execAsync('gh issue edit 42 --repo owner/repo --add-label "closed-out"'); // PAN-805-exempt: human-driven marker\n`,
    );

    const { stdout } = await execFileAsync('bash', [SCRIPT_PATH, tempDir]);
    expect(stdout).toContain('OK: No direct label write violations found');
  });

  it('ignores test files', async () => {
    const fixture = join(tempDir, 'something.test.ts');
    await writeFile(fixture, `await execAsync('gh issue edit 42 --repo owner/repo --add-label "in-progress"');`);

    const { stdout } = await execFileAsync('bash', [SCRIPT_PATH, tempDir]);
    expect(stdout).toContain('OK: No direct label write violations found');
  });

  it('passes cleanly on the real src/ tree', async () => {
    const { stdout, stderr } = await execFileAsync('bash', [SCRIPT_PATH, 'src/']);
    expect(stdout).toContain('OK: No direct label write violations found');
    expect(stderr).toBe('');
  });
});
