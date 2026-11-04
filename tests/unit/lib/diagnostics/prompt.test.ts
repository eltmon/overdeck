import { describe, expect, it } from 'vitest';

import { buildDiagnosePrompt } from '../../../../src/lib/diagnostics/prompt.js';

const BUNDLE_DIR = '/home/op/.overdeck/diagnostics/20261101T044453Z';

describe('buildDiagnosePrompt', () => {
  it('starts with the exact sentence "Overdeck diagnostic session."', () => {
    const prompt = buildDiagnosePrompt({ bundleDir: BUNDLE_DIR, issueStep: true });
    expect(prompt.startsWith('Overdeck diagnostic session.')).toBe(true);
  });

  it('contains the absolute bundleDir, MANIFEST.md, and TROUBLESHOOTING.md', () => {
    const prompt = buildDiagnosePrompt({ bundleDir: BUNDLE_DIR, issueStep: true });
    expect(prompt).toContain(BUNDLE_DIR);
    expect(prompt).toContain('MANIFEST.md');
    expect(prompt).toContain('TROUBLESHOOTING.md');
  });

  it('with issueStep: true, includes the gh issue create step gated on explicit confirmation', () => {
    const prompt = buildDiagnosePrompt({ bundleDir: BUNDLE_DIR, issueStep: true });
    expect(prompt).toContain('gh issue create --repo eltmon/overdeck');
    expect(prompt).toContain('explicit confirmation');
  });

  it('with issueStep: false, prohibits drafting or creating an upstream issue and omits gh issue create', () => {
    const prompt = buildDiagnosePrompt({ bundleDir: BUNDLE_DIR, issueStep: false });
    expect(prompt).toContain('Do not draft or create an upstream issue');
    expect(prompt).not.toContain('gh issue create');
  });
});
