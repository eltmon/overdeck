/**
 * Platform Detection
 *
 * Shared platform detection utility. Distinguishes between
 * native Linux, macOS, Windows, and WSL2.
 */

import { readFileSync } from 'fs';
import { platform } from 'os';
import { Effect } from 'effect';
import { FsError } from './errors.js';

export type Platform = 'linux' | 'darwin' | 'win32' | 'wsl';

export function detectPlatform(): Effect.Effect<Platform> {
  const os = platform();
  if (os === 'linux') {
    return Effect.try({
      try: () => readFileSync('/proc/version', 'utf8').toLowerCase(),
      catch: (cause) => new FsError({ path: '/proc/version', operation: 'read', cause }),
    }).pipe(
      Effect.map((release): Platform => {
        if (release.includes('microsoft') || release.includes('wsl')) {
          return 'wsl';
        }
        return 'linux';
      }),
      Effect.catchTag('FsError', () => Effect.succeed<Platform>('linux')),
    );
  }
  return Effect.succeed(os as 'darwin' | 'win32');
}
