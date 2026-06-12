import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('roles/review-requirements.md', () => {
  const content = readFileSync(resolve(process.cwd(), 'roles/review-requirements.md'), 'utf8');

  it('contains the Live Code Path Traces header and required field tokens', () => {
    expect(content).toContain('## Live Code Path Traces');
    expect(content).toContain('**File:**');
    expect(content).toContain('**Function:**');
    expect(content).toContain('**Path:**');
  });

  it('requires the section for in_pr_scope Implemented/Partial ACs only', () => {
    expect(content).toContain('in_pr_scope');
    expect(content).toContain('whole_feature_scope');
    expect(content).toContain('pre_existing');
    expect(content).toMatch(/Implemented.*Partial.*in_pr_scope|in_pr_scope.*Implemented.*Partial/s);
  });

  it('includes the zero-qualifying-ACs sentinel', () => {
    expect(content).toContain('None — no in_pr_scope ACs claimed Implemented or Partial.');
  });

  it('states the mechanical REVIEWER_FAILED enforcement', () => {
    expect(content).toContain('REVIEWER_FAILED');
    expect(content).toContain('**File:** \\`path:line\\`');
  });
});
