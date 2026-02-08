/**
 * Platform Detection
 *
 * Shared platform detection utility. Distinguishes between
 * native Linux, macOS, Windows, and WSL2.
 */

import { readFileSync } from 'fs';
import { platform } from 'os';

export type Platform = 'linux' | 'darwin' | 'win32' | 'wsl';

export function detectPlatform(): Platform {
  const os = platform();
  if (os === 'linux') {
    // Check for WSL
    try {
      const release = readFileSync('/proc/version', 'utf8').toLowerCase();
      if (release.includes('microsoft') || release.includes('wsl')) {
        return 'wsl';
      }
    } catch {}
    return 'linux';
  }
  return os as 'darwin' | 'win32';
}
