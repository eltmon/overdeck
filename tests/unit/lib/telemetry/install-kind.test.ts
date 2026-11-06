import { describe, expect, it } from 'vitest';
import {
  type InstallKindProbe,
  INSTALL_KIND_FILENAME,
  resolveInstallKind,
} from '../../../../src/lib/telemetry/install-kind.js';

function probe(overrides: Partial<InstallKindProbe> = {}): InstallKindProbe {
  return {
    overdeckHome: '/home/test/.overdeck',
    exists: () => false,
    readFile: () => '',
    isDevCheckout: false,
    ...overrides,
  };
}

describe('resolveInstallKind', () => {
  it('returns the marker value when present, even when isDevCheckout is true', () => {
    const result = resolveInstallKind(probe({
      exists: (path) => path.endsWith(INSTALL_KIND_FILENAME),
      readFile: () => 'remote_vm\n',
      isDevCheckout: true,
    }));
    expect(result).toBe('remote_vm');
  });

  it('ignores an unrecognized marker and falls through to dev_checkout', () => {
    const result = resolveInstallKind(probe({
      exists: (path) => path.endsWith(INSTALL_KIND_FILENAME),
      readFile: () => 'bogus',
      isDevCheckout: true,
    }));
    expect(result).toBe('dev_checkout');
  });

  it('returns container when a container marker exists', () => {
    const result = resolveInstallKind(probe({
      exists: (path) => path === '/.dockerenv' || path === '/run/.containerenv',
    }));
    expect(result).toBe('container');
  });

  it('returns user when no marker, not a dev checkout, and no container marker', () => {
    const result = resolveInstallKind(probe());
    expect(result).toBe('user');
  });

  it('never throws when exists and readFile probes throw EACCES', () => {
    const throwingProbe = probe({
      exists: () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
      readFile: () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    });
    expect(() => resolveInstallKind(throwingProbe)).not.toThrow();
    expect(resolveInstallKind(throwingProbe)).toBe('user');
  });
});
