import { describe, expect, it } from 'vitest';
import { detectPlatform, providerFor } from '../platform.js';
import { linuxProvider } from '../providers/linux.js';

const noOsRelease = () => null;

describe('detectPlatform', () => {
  it('returns linux for plain linux', () => {
    expect(detectPlatform({ platform: 'linux', env: {}, readOsRelease: () => '6.8.0-45-generic' })).toBe('linux');
  });

  it('returns linux when osrelease cannot be read', () => {
    expect(detectPlatform({ platform: 'linux', env: {}, readOsRelease: noOsRelease })).toBe('linux');
  });

  it('returns wsl when WSL_DISTRO_NAME is set', () => {
    expect(detectPlatform({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, readOsRelease: noOsRelease })).toBe('wsl');
  });

  it('ignores an empty WSL_DISTRO_NAME', () => {
    expect(detectPlatform({ platform: 'linux', env: { WSL_DISTRO_NAME: '' }, readOsRelease: noOsRelease })).toBe('linux');
  });

  it('returns wsl when osrelease names microsoft', () => {
    expect(
      detectPlatform({ platform: 'linux', env: {}, readOsRelease: () => '5.15.167.4-microsoft-standard-WSL2' }),
    ).toBe('wsl');
  });

  it('matches microsoft in osrelease case-insensitively', () => {
    expect(detectPlatform({ platform: 'linux', env: {}, readOsRelease: () => '4.4.0-19041-Microsoft' })).toBe('wsl');
  });

  it('returns darwin for darwin', () => {
    expect(detectPlatform({ platform: 'darwin', env: {}, readOsRelease: noOsRelease })).toBe('darwin');
  });

  it('returns unsupported for win32', () => {
    expect(detectPlatform({ platform: 'win32', env: {}, readOsRelease: noOsRelease })).toBe('unsupported');
  });
});

describe('providerFor', () => {
  it('returns the Linux provider for linux', () => {
    expect(providerFor('linux')).toBe(linuxProvider);
  });

  it('returns the wsl provider for wsl (PAN-5462)', () => {
    const provider = providerFor('wsl');
    expect(provider?.id).toBe('wsl');
    expect(provider?.blockedKeyPlatform).toBe('windows');
  });

  it.each(['darwin', 'unsupported'] as const)('returns null for %s', (id) => {
    expect(providerFor(id)).toBeNull();
  });
});
