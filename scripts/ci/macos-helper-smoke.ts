/**
 * CI smoke test for the macOS computer-use helper (PAN-5463, PRD WI-4 part B).
 *
 * Usage: npx tsx scripts/ci/macos-helper-smoke.ts "<path to Overdeck Computer Use.app>"
 *
 * Installs the built .app into a throwaway OVERDECK_HOME under $RUNNER_TEMP,
 * then drives it through the real TypeScript daemon client:
 *   1. connectOrLaunch + handshake must succeed and report platform darwin.
 *   2. getAppState for Finder must succeed or fail with permission_denied.
 *      GitHub's macOS runners may or may not pre-grant Accessibility (D-20),
 *      so either passes; any other error fails.
 *   3. terminate stops the daemon.
 * Exits 0 on pass, 1 with the error printed otherwise.
 */
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const appPath = process.argv[2];
  if (!appPath) throw new Error('usage: macos-helper-smoke.ts <path to Overdeck Computer Use.app>');
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) throw new Error('RUNNER_TEMP is not set; this script runs in GitHub Actions');

  // Set before the computer-use modules resolve any path.
  process.env.OVERDECK_HOME = join(runnerTemp, 'overdeck-home');
  const { installedHelperPath } = await import('../../src/lib/computer-use/macos-install.js');
  const { closeDaemonConnection, request } = await import('../../src/lib/computer-use/macos-daemon.js');
  const { isComputerUseError } = await import('../../src/lib/computer-use/errors.js');

  const installed = installedHelperPath();
  await mkdir(dirname(installed), { recursive: true, mode: 0o700 });
  await rm(installed, { recursive: true, force: true });
  await execFileAsync('/usr/bin/ditto', [appPath, installed]);
  console.log(`installed ${appPath} -> ${installed}`);

  try {
    const handshake = (await request('handshake', { session: 'ci' })) as Record<string, unknown>;
    console.log(`handshake: ${JSON.stringify(handshake)}`);
    if (handshake.platform !== 'darwin') {
      throw new Error(`handshake platform is ${JSON.stringify(handshake.platform)}, expected "darwin"`);
    }

    try {
      const state = (await request('getAppState', { app: 'Finder', session: 'ci', noScreenshot: true })) as Record<string, unknown>;
      const snapshot = (state.snapshot ?? {}) as Record<string, unknown>;
      console.log(`getAppState Finder: ok (snapshot ${String(snapshot.id)}, ${String(snapshot.elementCount)} elements)`);
    } catch (error) {
      if (isComputerUseError(error) && error.code === 'permission_denied') {
        console.log(`getAppState Finder: permission_denied (accepted on CI): ${error.message}`);
      } else {
        throw error;
      }
    }

    await request('terminate', {});
    console.log('terminate: ok');
  } finally {
    await closeDaemonConnection();
  }
}

main().then(
  () => {
    console.log('macos-helper-smoke: passed');
    process.exit(0);
  },
  (error: unknown) => {
    const code = (error as { code?: string }).code;
    console.error(`macos-helper-smoke: FAILED${code ? ` (${code})` : ''}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
