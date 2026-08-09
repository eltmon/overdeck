import { describe, expect, it } from 'vitest';
import {
  extractedBinaryName,
  getCliproxyBinary,
  isExecutableMode,
} from '../../src/lib/cliproxy.js';

describe('CLIProxy Windows paths', () => {
  it('adds the executable suffix only on Windows', () => {
    expect(getCliproxyBinary('win32')).toMatch(/cliproxy\.exe$/);
    expect(getCliproxyBinary('linux')).toMatch(/cliproxy$/);
    expect(getCliproxyBinary('linux')).not.toMatch(/\.exe$/);
  });

  it('treats Windows files as executable without Unix mode bits', () => {
    expect(isExecutableMode(0o644, 'win32')).toBe(true);
    expect(isExecutableMode(0o644, 'linux')).toBe(false);
    expect(isExecutableMode(0o755, 'linux')).toBe(true);
  });

  it('finds the platform-specific extracted binary name', () => {
    expect(extractedBinaryName('win32')).toBe('cli-proxy-api.exe');
    expect(extractedBinaryName('linux')).toBe('cli-proxy-api');
  });
});
