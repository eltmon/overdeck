#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const venvDir = resolve(repoRoot, '.moonshine-sidecar-venv');
const source = resolve(repoRoot, 'scripts/moonshine-sidecar.py');
const target = resolve(repoRoot, 'packages/moonshine-linux-x64/bin/moonshine-sidecar');
const python = process.env.PYTHON ?? 'python3';

function bin(name) {
  return resolve(venvDir, 'bin', name);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' },
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Moonshine linux-x64 sidecar must be built on Linux x64');
  }

  await rm(venvDir, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await run(python, ['-m', 'venv', venvDir]);
  await run(bin('python'), ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel', 'setuptools']);
  await run(bin('python'), ['-m', 'pip', 'install', 'moonshine-voice', 'pyinstaller']);

  try {
    await run(bin('pyinstaller'), [
      '--onefile',
      '--clean',
      '--name',
      'moonshine-sidecar',
      '--distpath',
      dirname(target),
      '--workpath',
      resolve(repoRoot, '.moonshine-sidecar-build'),
      '--specpath',
      resolve(repoRoot, '.moonshine-sidecar-build'),
      source,
    ]);
  } catch (error) {
    await run(bin('python'), ['-m', 'pip', 'freeze']).catch(() => {});
    throw error;
  }

  if (!existsSync(target)) {
    throw new Error(`PyInstaller completed but did not create ${target}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
