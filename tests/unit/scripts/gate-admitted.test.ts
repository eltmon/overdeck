import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WRAPPER = fileURLToPath(new URL('../../../scripts/gate-admitted.mjs', import.meta.url));

// PAN-5617: OVERDECK_GATE_ADMITTED=1 takes the bypass path on purpose, so these tests never touch the real queue.
const ADMITTED_ENV = { ...process.env, OVERDECK_GATE_ADMITTED: '1' };

describe('scripts/gate-admitted.mjs (PAN-5617)', () => {
  it('passes the command exit code through', () => {
    const result = spawnSync(
      process.execPath,
      [WRAPPER, 'chain:test', '--', process.execPath, '-e', 'process.exit(3)'],
      { encoding: 'utf8', env: ADMITTED_ENV },
    );
    expect(result.status).toBe(3);
  });

  it('passes args and the environment through to the command', () => {
    const result = spawnSync(
      process.execPath,
      [
        WRAPPER,
        'chain:test',
        '--',
        process.execPath,
        '-e',
        "process.stdout.write(process.argv.slice(1).join(',') + '|' + process.env.OVERDECK_GATE_ADMITTED)",
        'a',
        'b',
      ],
      { encoding: 'utf8', env: ADMITTED_ENV },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('a,b|1');
  });

  it.each([
    ['chain:test', 'node'],
    ['chain:test', '--'],
    ['--', 'node'],
  ])('exits 2 with the usage line on malformed argv (%s %s)', (...rest) => {
    const result = spawnSync(process.execPath, [WRAPPER, ...rest], { encoding: 'utf8', env: ADMITTED_ENV });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: node scripts/gate-admitted.mjs <footprint-key> -- <command> [args…]');
  });

  it('runs the command with OVERDECK_GATE_ADMISSION=0 when the admission runner cannot load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-admitted-'));
    try {
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(join(dir, 'scripts', 'gate-admitted.mjs'), readFileSync(WRAPPER, 'utf8'));

      const env = { ...process.env };
      delete env.CI;
      delete env.OVERDECK_GATE_ADMITTED;
      delete env.OVERDECK_GATE_ADMISSION;

      const result = spawnSync(
        process.execPath,
        [
          join(dir, 'scripts', 'gate-admitted.mjs'),
          'chain:test',
          '--',
          process.execPath,
          '-e',
          'process.stdout.write(String(process.env.OVERDECK_GATE_ADMISSION))',
        ],
        { encoding: 'utf8', env, cwd: dir },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe('0');
      expect(result.stderr).toContain('[gate-admission] proceeding without admission:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
