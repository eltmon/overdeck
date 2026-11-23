import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { scripts: Record<string, string> };

const TYPECHECK_LANES = [
  'node scripts/tsc-admitted.mjs --noEmit',
  'npm run typecheck:hooks',
  'npm run typecheck:evals',
  'npm run typecheck:dashboard',
  'npm run typecheck:frontend',
  'npm run typecheck:acp',
  'npm run typecheck:account',
  'npm run typecheck:share',
  'npm run typecheck:connect',
  'npm run typecheck:contracts',
  'npm run typecheck:anywhere-channel',
  'npm run typecheck:mobile',
];

describe('admitted chains (PAN-5617)', () => {
  it('routes npm run typecheck through the chain wrapper', () => {
    expect(packageJson.scripts.typecheck).toBe('node scripts/gate-admitted.mjs chain:typecheck -- npm run typecheck:lanes');
  });

  it('keeps the former 12-step typecheck chain under typecheck:lanes', () => {
    expect(packageJson.scripts['typecheck:lanes']!.split(' && ')).toEqual(TYPECHECK_LANES);
  });

  it('every typecheck:<lane> step still admits itself when run alone', () => {
    const laneSteps = TYPECHECK_LANES.filter((step) => step.startsWith('npm run typecheck:'))
      .map((step) => step.replace('npm run ', ''));
    for (const lane of laneSteps) {
      const script = packageJson.scripts[lane];
      expect(script).toBeDefined();
      expect(script!.startsWith('node scripts/tsc-admitted.mjs') || script!.startsWith('bash scripts/lint-')).toBe(true);
    }
  });

  it('routes npm run lint:effect-diagnostics through the chain wrapper', () => {
    expect(packageJson.scripts['lint:effect-diagnostics']).toBe(
      'node scripts/gate-admitted.mjs chain:lint:effect-diagnostics -- bash scripts/lint-effect-diagnostics.sh',
    );
  });

  it('keeps npm run lint:effect-diagnostics as a step of npm run lint', () => {
    const steps = packageJson.scripts.lint!.split('&&').map((step) => step.trim());
    expect(steps).toContain('npm run lint:effect-diagnostics');
  });
});
