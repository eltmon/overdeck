import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  'CLAUDE.md',
  'docs/AGENT-STATE-PLANES.md',
  'docs/STATE-PLANE-COMMIT-POLICY.md',
  'docs/CONTEXT-LAYERS.md',
  'configuration/context-layers.mdx',
  'docs/VBRIEF.md',
];

describe('state-plane documentation', () => {
  it('documents branch-relative and on-disk locations without mixed ref/path syntax', () => {
    const text = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(text).toContain('`${OVERDECK_HOME}/state/<project>');
    expect(text).toContain('on `overdeck-state`');
    expect(text).not.toMatch(/<projectRoot>\/overdeck-state:/);
    expect(text).not.toMatch(/`overdeck-state:(drafts|specs|records|continues)\//);
  });

  it('preserves the PAN-967 historical transition and states the current spec home separately', () => {
    const text = readFileSync('docs/VBRIEF.md', 'utf8');
    expect(text).toContain('PAN-967 replaced `.planning/plan.vbrief.json` with workspace-local `.pan/spec.vbrief.json`');
    expect(text).toContain('current canonical spec is `specs/<file>` on `overdeck-state`');
  });

  it('allows legacy permanent paths only in explicitly historical top-level docs', () => {
    const matches = readdirSync('docs', { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `docs/${entry.name}`)
      .filter((file) => /\.pan\/(records|specs|drafts)/.test(readFileSync(file, 'utf8')))
      .sort();
    expect(matches).toEqual([
      'docs/FLYWHEEL-STATE.md',
      'docs/STATE-PLANE-COMMIT-POLICY.md',
    ]);
    expect(readFileSync('docs/FLYWHEEL-STATE.md', 'utf8')).toContain('Historical-path note (PAN-2541)');
    expect(readFileSync('docs/STATE-PLANE-COMMIT-POLICY.md', 'utf8')).toContain('old permanent locations');
  });
});
