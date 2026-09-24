/**
 * PAN-3965 (review of #3993): the work prompt's test wording follows the
 * project — "the full suite runs on CI" only in a `verification.tests: ci`
 * project, `npx vitest run` only in a vitest checkout.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findProjectByPath = vi.hoisted(() => vi.fn());

vi.mock('../../projects.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../projects.js')>(),
  findProjectByPath,
}));

import { buildWorkAgentPrompt } from '../work-agent-prompt.js';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'overdeck-work-prompt-tests-mode-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function prompt(): Promise<string> {
  return buildWorkAgentPrompt({
    issueId: 'PAN-3965',
    env: 'LOCAL',
    workspacePath: root,
    projectRoot: root,
    skipDynamicContext: true,
  });
}

describe('work prompt test wording', () => {
  it('a CI-mode vitest project: touched tests with vitest, the full suite on CI', async () => {
    writeFileSync(join(root, 'vitest.config.ts'), 'export default {};\n');
    findProjectByPath.mockReturnValue({ name: 'Overdeck', path: root, verification: { tests: 'ci' } });

    const text = await prompt();

    expect(text).toContain('`npx vitest run <test files you changed or whose subjects you changed>`');
    expect(text).toContain('it runs on CI after `pan done`');
    expect(text).not.toContain('`pan done` runs it as the verification gate');
  });

  it('a local-mode project without vitest: no vitest command, no CI wording', async () => {
    writeFileSync(join(root, 'go.mod'), 'module example.com/x\n');
    findProjectByPath.mockReturnValue({ name: 'myn-cli', path: root, verification: { tests: 'local' } });

    const text = await prompt();

    expect(text).not.toContain('npx vitest');
    expect(text).not.toContain('runs on CI');
    expect(text).toContain("the project's test runner, scoped to those test files or packages");
    expect(text).toContain('`pan done` runs it as the verification gate');
  });

  it('detects vitest from package.json', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^4.0.0' } }));
    findProjectByPath.mockReturnValue(null);

    const text = await prompt();

    expect(text).toContain('npx vitest run <changed test files>');
    expect(text).not.toContain('runs on CI');
  });
});
