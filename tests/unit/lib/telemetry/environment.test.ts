import { describe, expect, it } from 'vitest';
import {
  detectTelemetryAutoExclusion,
  telemetryEnvironmentForcesOn,
  type TelemetryEnvironmentInputs,
} from '../../../../src/lib/telemetry/environment.js';

function inputs(overrides: Partial<TelemetryEnvironmentInputs> = {}): TelemetryEnvironmentInputs {
  return {
    env: {},
    overdeckHome: '/home/test/.overdeck',
    temporaryRoots: ['/tmp'],
    realpath: (path) => path,
    ...overrides,
  };
}

describe('detectTelemetryAutoExclusion', () => {
  it('returns ci for a truthy CI env var, and null for a falsy one with a non-temp home', () => {
    expect(detectTelemetryAutoExclusion(inputs({ env: { CI: 'true' } }))).toBe('ci');
    expect(detectTelemetryAutoExclusion(inputs({ env: { CI: '1' } }))).toBe('ci');
    expect(detectTelemetryAutoExclusion(inputs({ env: { CI: '0' } }))).toBeNull();
    expect(detectTelemetryAutoExclusion(inputs({ env: { CI: 'false' } }))).toBeNull();
    expect(detectTelemetryAutoExclusion(inputs({ env: { CI: '' } }))).toBeNull();
  });

  it('returns temporary_home for a home under a temp root, including a ..-prefixed child', () => {
    expect(detectTelemetryAutoExclusion(inputs({
      overdeckHome: '/tmp/odk-a-1',
      temporaryRoots: ['/tmp'],
    }))).toBe('temporary_home');
    expect(detectTelemetryAutoExclusion(inputs({
      overdeckHome: '/tmp/..smoke-123',
      temporaryRoots: ['/tmp'],
    }))).toBe('temporary_home');
    expect(detectTelemetryAutoExclusion(inputs({
      overdeckHome: '/tmp',
      temporaryRoots: ['/tmp'],
    }))).toBe('temporary_home');
  });

  it('returns null for a home that merely shares a prefix with a temp root', () => {
    expect(detectTelemetryAutoExclusion(inputs({
      overdeckHome: '/tmpfoo/x',
      temporaryRoots: ['/tmp'],
    }))).toBeNull();
  });

  it('resolves through realpath before comparing, and still decides when realpath throws', () => {
    const realHome = '/private/var/folders/ab/T/x';
    const realRoot = '/private/var/folders/ab/T';
    const realpath = (path: string): string => {
      if (path === '/var/folders/ab/T/x') return realHome;
      if (path === '/var/folders/ab/T') return realRoot;
      return path;
    };
    expect(detectTelemetryAutoExclusion(inputs({
      overdeckHome: '/var/folders/ab/T/x',
      temporaryRoots: ['/var/folders/ab/T'],
      realpath,
    }))).toBe('temporary_home');

    const throwingRealpath = (): string => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    expect(detectTelemetryAutoExclusion(inputs({
      overdeckHome: '/var/folders/ab/T/x',
      temporaryRoots: ['/var/folders/ab/T'],
      realpath: throwingRealpath,
    }))).toBe('temporary_home');
  });
});

describe('telemetryEnvironmentForcesOn', () => {
  it('returns true for 1, true, or whitespace/case-insensitive true', () => {
    expect(telemetryEnvironmentForcesOn({ OVERDECK_TELEMETRY: '1' })).toBe(true);
    expect(telemetryEnvironmentForcesOn({ OVERDECK_TELEMETRY: 'true' })).toBe(true);
    expect(telemetryEnvironmentForcesOn({ OVERDECK_TELEMETRY: ' TRUE ' })).toBe(true);
  });

  it('returns false for 0, other truthy-looking strings, or unset', () => {
    expect(telemetryEnvironmentForcesOn({ OVERDECK_TELEMETRY: '0' })).toBe(false);
    expect(telemetryEnvironmentForcesOn({ OVERDECK_TELEMETRY: 'yes' })).toBe(false);
    expect(telemetryEnvironmentForcesOn({})).toBe(false);
  });
});
