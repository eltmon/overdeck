import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const installer = join(process.cwd(), 'scripts', 'install.sh');

async function fakeInstall(nodeMajor: number) {
  const root = await mkdtemp(join(tmpdir(), 'overdeck-install-test-'));
  const home = join(root, 'home');
  const fakeBin = join(root, 'bin');
  const npmLog = join(root, 'npm.log');
  await mkdir(home, { recursive: true });
  await mkdir(fakeBin, { recursive: true });

  await writeFile(join(fakeBin, 'node'), `#!/bin/sh\nif [ "$1" = "-p" ]; then echo ${nodeMajor}; else echo v${nodeMajor}.0.0; fi\n`);
  await writeFile(join(fakeBin, 'npm'), `#!/bin/sh
echo "prefix=$NPM_CONFIG_PREFIX args=$*" >> "$NPM_LOG"
case "$*" in
  *"install -g node@24"*)
    mkdir -p "$NPM_CONFIG_PREFIX/bin"
    printf '%s\n' '#!/bin/sh' 'if [ "$1" = "-p" ]; then echo 24; else echo v24.0.0; fi' > "$NPM_CONFIG_PREFIX/bin/node"
    chmod +x "$NPM_CONFIG_PREFIX/bin/node"
    ;;
  *"install -g @overdeck/core@latest"*)
    mkdir -p "$NPM_CONFIG_PREFIX/bin"
    printf '%s\n' '#!/bin/sh' 'echo 0.0.0-test' > "$NPM_CONFIG_PREFIX/bin/overdeck"
    chmod +x "$NPM_CONFIG_PREFIX/bin/overdeck"
    ;;
esac
exit 0
`);
  await chmod(join(fakeBin, 'node'), 0o755);
  await chmod(join(fakeBin, 'npm'), 0o755);

  const result = spawnSync('sh', [installer], {
    encoding: 'utf8',
    env: {
      HOME: home,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      SHELL: '/bin/bash',
      NPM_LOG: npmLog,
    },
  });

  return {
    ...result,
    home,
    npmLog: await readFile(npmLog, 'utf8'),
  };
}

describe('install.sh', () => {
  it('installs Overdeck into a user-owned prefix without sudo', async () => {
    const result = await fakeInstall(24);

    expect(result.status, result.stderr).toBe(0);
    expect(result.npmLog).toContain(`prefix=${result.home}/.local args=install -g @overdeck/core@latest`);
    expect(result.stdout + result.stderr).not.toContain('sudo');
    await expect(readFile(join(result.home, '.profile'), 'utf8')).resolves.toContain(
      'export PATH="$HOME/.local/bin:$PATH"',
    );
    await expect(readFile(join(result.home, '.bashrc'), 'utf8')).resolves.toContain(
      'export PATH="$HOME/.local/bin:$PATH"',
    );
  });

  it('supports installing with Node 26 without downgrading the runtime', async () => {
    const result = await fakeInstall(26);

    expect(result.status, result.stderr).toBe(0);
    expect(result.npmLog).not.toContain('node@24');
    expect(result.npmLog).toContain(`prefix=${result.home}/.local args=install -g @overdeck/core@latest`);
  });
});
