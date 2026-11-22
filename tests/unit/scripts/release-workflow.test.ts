import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

// PAN-5595: the three npm publish steps call scripts/npm-publish-retry-safe.sh
// instead of inlining npm view / npm publish, so staged versions (E409) are
// handled consistently and the job no longer goes green while a package is
// still staged.
describe('release workflow npm publishes', () => {
  async function loadNpmJobSteps(): Promise<Array<Record<string, any>>> {
    const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');
    const parsed = parseYaml(workflow);
    return parsed.jobs.npm.steps;
  }

  it('calls npm-publish-retry-safe.sh from each publish step with the expected package argument', async () => {
    const steps = await loadNpmJobSteps();
    const byName = new Map(steps.map((step) => [step.name, step]));

    const expectations: Array<[string, string]> = [
      ['Publish CLI to npm', '"$TGZ"'],
      ['Publish contracts to npm', 'packages/contracts'],
      ['Publish desktop to npm', 'apps/desktop'],
    ];

    for (const [stepName, pkgArg] of expectations) {
      const step = byName.get(stepName);
      expect(step, `missing step: ${stepName}`).toBeDefined();
      expect(step!.run).toContain('bash scripts/npm-publish-retry-safe.sh --tag "$NPM_TAG"');
      expect(step!.run).toContain(pkgArg);
      expect(step!.env?.NPM_TAG).toBe('${{ needs.classify.outputs.npm_tag }}');
    }
  });

  it('contains no npm publish or npm view calls in the npm job', async () => {
    const steps = await loadNpmJobSteps();
    for (const step of steps) {
      if (typeof step.run === 'string') {
        expect(step.run).not.toContain('npm publish');
        expect(step.run).not.toContain('npm view');
      }
    }
  });

  it('ships scripts/npm-publish-retry-safe.sh', () => {
    expect(existsSync(join(process.cwd(), 'scripts', 'npm-publish-retry-safe.sh'))).toBe(true);
  });
});
