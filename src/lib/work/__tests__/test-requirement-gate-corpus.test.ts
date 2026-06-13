import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectTestRequirements, countTestDeltaInDiff } from '../test-requirement-gate.js';

const FIXTURES_DIR = join(__dirname, 'fixtures', 'test-gate-corpus');
const ISSUES = ['PAN-1326', 'PAN-1256', 'PAN-1257', 'PAN-1175', 'PAN-1173', 'PAN-1168', 'PAN-1111'];

describe('test-requirement gate corpus', () => {
  it('has a fixture directory for each audited issue (AC1)', () => {
    const dirs = readdirSync(FIXTURES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const issue of ISSUES) {
      expect(dirs).toContain(issue);
    }
  });

  it.each(ISSUES)('gate fires for %s (detector > 0 and counter == 0) (AC2)', (issue) => {
    const body = readFileSync(join(FIXTURES_DIR, issue, 'body.md'), 'utf-8');
    const numstat = readFileSync(join(FIXTURES_DIR, issue, 'diff.numstat'), 'utf-8');

    const requirements = detectTestRequirements(body);
    const delta = countTestDeltaInDiff(numstat);

    expect(requirements.length).toBeGreaterThan(0);
    expect(delta).toBe(0);
  });
});
