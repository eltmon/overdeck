import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { agentTmpdirLauncherLine, getAgentTmpDir } from '../agent-tmpdir.js';

const execFileAsync = promisify(execFile);

describe('getAgentTmpDir', () => {
  const originalOverdeckHome = process.env.OVERDECK_HOME;

  afterEach(() => {
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
  });

  it('returns <OVERDECK_HOME>/tmp when OVERDECK_HOME is overridden', () => {
    process.env.OVERDECK_HOME = '/x/home';
    expect(getAgentTmpDir()).toBe(join('/x/home', 'tmp'));
  });
});

describe('agentTmpdirLauncherLine', () => {
  it('builds the exact mkdir/chmod/export line, quoted for a path with a space', () => {
    expect(agentTmpdirLauncherLine('/a b/tmp')).toBe(
      "mkdir -p '/a b/tmp' && chmod 700 '/a b/tmp' && export CLAUDE_CODE_TMPDIR='/a b/tmp'"
    );
  });

  it('contains no $, so escapeForBase64 would leave it unchanged', () => {
    expect(agentTmpdirLauncherLine('/a b/tmp')).not.toContain('$');
  });

  it('applies mode 0700 and exports the path when run in bash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-tmpdir-test-'));
    const dir = join(root, 'tmp');
    await mkdir(dir, { mode: 0o775 });

    const line = agentTmpdirLauncherLine(dir);
    const { stdout } = await execFileAsync('bash', ['-c', `${line}; printf %s "$CLAUDE_CODE_TMPDIR"`]);

    expect(stdout).toBe(dir);
    const { mode } = await stat(dir);
    expect(mode & 0o777).toBe(0o700);
  });
});
