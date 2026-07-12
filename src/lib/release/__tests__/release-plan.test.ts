import { describe, expect, it } from 'vitest';
import type { ReleaseConfig } from '../../projects.js';
import { resolveReleasePlan } from '../release-plan.js';

describe('resolveReleasePlan', () => {
  it('orders MYN-shaped components and omits skipped components', () => {
    const release: ReleaseConfig = {
      components: {
        frontend: {
          trigger: 'auto',
          depends_on: ['api'],
        },
        docs: {
          trigger: 'skip',
        },
        api: {
          trigger: 'auto',
        },
      },
    };

    const plan = resolveReleasePlan(release);

    expect(plan.map((entry) => entry.component)).toEqual(['api', 'frontend']);
    expect(plan.map((entry) => entry.releaseOrder)).toEqual([0, 1]);
  });

  it('names cycle members when dependencies contain a cycle', () => {
    const release: ReleaseConfig = {
      components: {
        a: {
          trigger: 'auto',
          depends_on: ['b'],
        },
        b: {
          trigger: 'auto',
          depends_on: ['a'],
        },
      },
    };

    expect(() => resolveReleasePlan(release)).toThrow(/a -> b -> a/);
  });

  it('places every component strictly after active dependencies', () => {
    const release: ReleaseConfig = {
      components: {
        frontend: {
          trigger: 'auto',
          depends_on: ['api', 'docs', 'missing'],
        },
        worker: {
          trigger: 'manual',
          depends_on: ['api'],
        },
        api: {
          trigger: 'auto',
        },
        docs: {
          trigger: 'skip',
        },
      },
    };

    const plan = resolveReleasePlan(release);
    const order = new Map(plan.map((entry) => [entry.component, entry.releaseOrder]));

    for (const entry of plan) {
      for (const dependency of entry.dependsOn) {
        expect(order.get(entry.component)).toBeGreaterThan(order.get(dependency)!);
      }
    }
    expect(plan.map((entry) => entry.component)).not.toContain('docs');
    expect(plan.find((entry) => entry.component === 'frontend')?.notes).toEqual([
      'Dependency "docs" is skipped; treated as satisfied.',
      'Dependency "missing" is absent; treated as satisfied.',
    ]);
  });
});
