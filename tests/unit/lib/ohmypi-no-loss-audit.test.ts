/**
 * PAN-1989 no-loss audit gate (workspace-8bebw).
 *
 * Three invariants:
 * 1. Every row in docs/ohmypi-no-loss-audit.md is verified (no bare `[ ]`).
 * 2. No runnable `pi --mode` launch path survives in the active runtime code.
 * 3. No @mariozechner/pi-coding-agent runtime import remains.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../..');

function grep(file: string, pattern: string): number {
  return parseInt(
    execSync(`grep -c "${pattern}" "${file}" 2>/dev/null || echo 0`, { encoding: 'utf8' }).trim(),
    10,
  );
}

function grepDir(dir: string, pattern: string, include = '*.ts'): number {
  return parseInt(
    execSync(
      `grep -r "${pattern}" "${dir}" --include="${include}" 2>/dev/null | wc -l`,
      { encoding: 'utf8' },
    ).trim(),
    10,
  );
}

describe('PAN-1989 ohmypi no-loss audit gate', () => {
  it('every row in docs/ohmypi-no-loss-audit.md has a verified disposition', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs/ohmypi-no-loss-audit.md'), 'utf8');
    const unverifiedRows = doc
      .split('\n')
      .filter(line => /^\| [SD]\d/.test(line.trimStart()))
      .filter(line => line.includes('[ ]'));
    expect(
      unverifiedRows,
      `Unverified rows still present in docs/ohmypi-no-loss-audit.md:\n${unverifiedRows.join('\n')}`,
    ).toHaveLength(0);
  });

  it('active ohmypi runtime (ohmypi.ts) does not pass harness pi to the launcher', () => {
    const count = grep(
      join(REPO_ROOT, 'src/lib/runtimes/ohmypi.ts'),
      "harness: 'pi'",
    );
    expect(count, "ohmypi.ts must not pass harness: 'pi' to generateLauncherScript").toBe(0);
  });

  it('runtime registry does not route to a pi runtime slot', () => {
    const count = grep(
      join(REPO_ROOT, 'src/lib/runtimes/index.ts'),
      "this.get('pi')",
    );
    expect(count, "runtimes/index.ts must not return a 'pi' runtime slot (legacy 'pi' harness → ohmypi adapter)").toBe(0);
  });

  it('no @mariozechner/pi-coding-agent runtime import in source', () => {
    const count = grepDir(join(REPO_ROOT, 'src'), '@mariozechner/pi-coding-agent');
    expect(count, '@mariozechner/pi-coding-agent must not appear in source imports').toBe(0);
  });

  it('no @mariozechner/pi-coding-agent in runtime package.json dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const piDeps = Object.keys(deps).filter(d => d.includes('pi-coding-agent'));
    expect(piDeps, `pi-coding-agent must not appear in package.json deps`).toHaveLength(0);
  });
});
