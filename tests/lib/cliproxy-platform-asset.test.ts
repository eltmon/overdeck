import { describe, it, expect } from 'vitest';
import { detectPlatformAsset } from '../../src/lib/cliproxy.js';

// Regression guard for the darwin/linux ARM asset name: CLIProxyAPI publishes
// ARM builds as `aarch64`, not `arm64`. Mapping process.arch === 'arm64' to
// 'arm64' produced a 404 download that curl silently saved, then surfaced as
// the misleading "tar: Unrecognized archive format" on Apple Silicon.
describe('detectPlatformAsset', () => {
  it('maps darwin/arm64 to the aarch64 asset', () => {
    expect(detectPlatformAsset('darwin', 'arm64')).toEqual({
      archive: expect.stringMatching(/^CLIProxyAPI_[\d.]+_darwin_aarch64\.tar\.gz$/),
    });
  });

  it('maps linux/arm64 to the aarch64 asset', () => {
    expect(detectPlatformAsset('linux', 'arm64')).toEqual({
      archive: expect.stringMatching(/^CLIProxyAPI_[\d.]+_linux_aarch64\.tar\.gz$/),
    });
  });

  it('maps x64 to the amd64 asset', () => {
    expect(detectPlatformAsset('darwin', 'x64')).toEqual({
      archive: expect.stringMatching(/^CLIProxyAPI_[\d.]+_darwin_amd64\.tar\.gz$/),
    });
    expect(detectPlatformAsset('linux', 'x64')).toEqual({
      archive: expect.stringMatching(/^CLIProxyAPI_[\d.]+_linux_amd64\.tar\.gz$/),
    });
  });

  it('returns null for unsupported platforms and arches', () => {
    expect(detectPlatformAsset('win32', 'x64')).toBeNull();
    expect(detectPlatformAsset('darwin', 'ia32')).toBeNull();
  });
});
