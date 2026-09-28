import { describe, it, expect } from 'vitest';
import { evaluatePrereqGate, forgivenPrereqNames, type PrereqResult } from '../../../src/cli/commands/install-prereqs.js';

// PAN-4282 D14, FR-23: `pan install` warns instead of failing on Docker,
// ast-grep and (under Herdr) tmux.

function passingResults(overrides: Partial<Record<string, Partial<PrereqResult>>> = {}): PrereqResult[] {
  const base: PrereqResult[] = [
    { name: 'Node.js', passed: true, message: 'v22.0.0' },
    { name: 'Git', passed: true, message: 'installed' },
    { name: 'Docker', passed: true, message: 'running' },
    { name: 'tmux', passed: true, message: 'installed' },
    { name: 'mkcert', passed: true, message: 'installed' },
    { name: 'jq', passed: true, message: 'installed' },
    { name: 'ttyd', passed: true, message: 'installed' },
    { name: 'ast-grep', passed: true, message: 'installed' },
    { name: 'Herdr', passed: true, message: 'installed' },
  ];
  return base.map((result) => (overrides[result.name] ? { ...result, ...overrides[result.name] } : result));
}

describe('evaluatePrereqGate', () => {
  it('forgives a stopped Docker and warns with the "not running" variant', () => {
    const results = passingResults({ Docker: { passed: false, message: 'not running' } });
    const { allPassed, warnings } = evaluatePrereqGate(results, 'herdr');

    expect(allPassed).toBe(true);
    expect(warnings).toContain('Docker not running — workspace containers are unavailable until it starts.');
  });

  it('forgives a missing Docker and warns with the "not found" variant', () => {
    const results = passingResults({ Docker: { passed: false, message: 'not found' } });
    const { allPassed, warnings } = evaluatePrereqGate(results, 'herdr');

    expect(allPassed).toBe(true);
    expect(warnings).toContain('Docker not found — workspace containers are unavailable until it is installed.');
  });

  it('forgives a missing ast-grep and warns', () => {
    const results = passingResults({ 'ast-grep': { passed: false, message: 'not found' } });
    const { allPassed, warnings } = evaluatePrereqGate(results, 'herdr');

    expect(allPassed).toBe(true);
    expect(warnings).toContain('ast-grep missing — will be installed later.');
  });

  it('forgives a missing tmux under the herdr backend and warns about plain terminals', () => {
    const results = passingResults({ tmux: { passed: false, message: 'not found' } });
    const { allPassed, warnings } = evaluatePrereqGate(results, 'herdr');

    expect(allPassed).toBe(true);
    expect(warnings.some((w) => w.includes('plain terminals'))).toBe(true);
  });

  it('uses the Linux tmux hint by default and the macOS hint on darwin', () => {
    const results = passingResults({ tmux: { passed: false, message: 'not found' } });

    const linux = evaluatePrereqGate(results, 'herdr', 'linux');
    expect(linux.warnings.some((w) => w.includes('sudo apt install tmux'))).toBe(true);

    const mac = evaluatePrereqGate(results, 'herdr', 'darwin');
    expect(mac.warnings.some((w) => w.includes('brew install tmux'))).toBe(true);
  });

  it('fails the gate when tmux is missing under the tmux backend', () => {
    const results = passingResults({ tmux: { passed: false, message: 'not found' } });
    const { allPassed, warnings } = evaluatePrereqGate(results, 'tmux');

    expect(allPassed).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it('fails the gate when git is missing, under either backend', () => {
    const results = passingResults({ Git: { passed: false, message: 'not found' } });

    expect(evaluatePrereqGate(results, 'herdr').allPassed).toBe(false);
    expect(evaluatePrereqGate(results, 'tmux').allPassed).toBe(false);
  });

  it('adds no extra warning line for mkcert, ttyd, jq or Herdr', () => {
    const results = passingResults({
      mkcert: { passed: false, message: 'not found (will auto-install)' },
      ttyd: { passed: false, message: 'not found' },
      jq: { passed: false, message: 'not found (will auto-install)' },
      Herdr: { passed: false, message: 'not found (will auto-install)' },
    });
    const { allPassed, warnings } = evaluatePrereqGate(results, 'herdr');

    expect(allPassed).toBe(true);
    expect(warnings).toHaveLength(0);
  });
});

describe('forgivenPrereqNames', () => {
  it('includes tmux only under the herdr backend', () => {
    expect(forgivenPrereqNames('herdr')).toContain('tmux');
    expect(forgivenPrereqNames('tmux')).not.toContain('tmux');
  });
});
