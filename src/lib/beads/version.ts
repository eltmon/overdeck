import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MINIMUM_BD_VERSION = '1.1.0';

export function parseBdVersion(output: string): string | null {
  return output.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function compareBdVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function isSupportedBdVersion(version: string): boolean {
  return compareBdVersions(version, MINIMUM_BD_VERSION) >= 0;
}

export function unsupportedBdVersionMessage(version: string): string {
  return `Installed bd ${version} is below the required minimum ${MINIMUM_BD_VERSION}; canonical Dolt synchronization and writes are blocked until bd is upgraded.`;
}

export function assertSupportedBdVersion(version: string): void {
  if (!isSupportedBdVersion(version)) throw new Error(unsupportedBdVersionMessage(version));
}

export function readInstalledBdVersionSync(): string | null {
  try {
    return parseBdVersion(execFileSync('bd', ['--version'], { encoding: 'utf8', stdio: 'pipe' }));
  } catch {
    return null;
  }
}

export async function readInstalledBdVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('bd', ['--version'], { encoding: 'utf8' });
    return parseBdVersion(stdout);
  } catch {
    return null;
  }
}
