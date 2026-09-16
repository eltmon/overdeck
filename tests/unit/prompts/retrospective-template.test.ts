/**
 * Prompt invariant test for the pipeline retrospective kickoff template.
 *
 * roles/retrospective.md seeds a read-only cross-issue retrospective
 * conversation. Its safety rails (the read-only ground rules) and its
 * substitution contract (the five {{...}} placeholders the renderer fills)
 * are load-bearing: a template that loses the read-only clause or grows an
 * unrendered token silently changes what the conversation is allowed to do
 * or ships literal {{...}} text to the agent.
 *
 * A deliberate prompt change must update this test in the same PR and include a
 * `Prompt-Change:` trailer in the commit message.
 *
 * Issue: PAN-3841
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const template = fs.readFileSync(path.join(repoRoot, 'roles/retrospective.md'), 'utf-8');

const RAIL_MESSAGE =
  'This anchor is a load-bearing safety rail (PAN-3841, retrospective template contract). ' +
  'A deliberate prompt change must update this test in the same PR and include a Prompt-Change: trailer.';

const EXPECTED_PLACEHOLDERS = [
  '{{WINDOW_LABEL}}',
  '{{WINDOW_START}}',
  '{{WINDOW_END}}',
  '{{OVERDECK_HOME}}',
  '{{PROJECT_LINES}}',
];

function groundRulesSection(body: string): string {
  const match = body.match(/## Ground rules \(read-only\)([\s\S]*?)(\n## |\s*$)/);
  expect(match, `Expected roles/retrospective.md to contain a "## Ground rules (read-only)" section. ${RAIL_MESSAGE}`).not.toBeNull();
  return match![1];
}

function placeholderSet(body: string): Set<string> {
  return new Set(body.match(/\{\{[^}]+\}\}/g) ?? []);
}

function assertTemplateShape(body: string): void {
  const section = groundRulesSection(body);
  for (const forbidden of ['pan start', 'pan kill', 'pan tell', 'gh issue create', 'git push']) {
    expect(
      section,
      `Expected the read-only ground rules to forbid \`${forbidden}\`. ${RAIL_MESSAGE}`,
    ).toContain(forbidden);
  }

  const tokens = placeholderSet(body);
  expect(
    tokens,
    `Expected the set of {{...}} tokens to equal exactly ${EXPECTED_PLACEHOLDERS.join(', ')}. ${RAIL_MESSAGE}`,
  ).toEqual(new Set(EXPECTED_PLACEHOLDERS));
  for (const placeholder of EXPECTED_PLACEHOLDERS) {
    expect(body, `Expected ${placeholder} to occur at least once. ${RAIL_MESSAGE}`).toContain(placeholder);
  }

  const outputMatch = body.match(/## Output shape([\s\S]*)$/);
  expect(outputMatch, `Expected roles/retrospective.md to contain a "## Output shape" section. ${RAIL_MESSAGE}`).not.toBeNull();
  const output = outputMatch![1];
  const headings = ['Headline', 'Pipeline and substrate faults', 'Work-agent quality faults', 'Recommended follow-ups'];
  let lastIndex = -1;
  for (const heading of headings) {
    const index = output.indexOf(heading);
    expect(index, `Expected the output shape to contain the "${heading}" heading. ${RAIL_MESSAGE}`).toBeGreaterThan(-1);
    expect(
      index,
      `Expected "${heading}" to appear after the previous output heading. ${RAIL_MESSAGE}`,
    ).toBeGreaterThan(lastIndex);
    lastIndex = index;
  }
}

describe('retrospective template invariants', () => {
  it('has retrospective frontmatter', () => {
    expect(
      template,
      `Expected roles/retrospective.md frontmatter to contain "name: retrospective". ${RAIL_MESSAGE}`,
    ).toMatch(/^---\r?\n[\s\S]*name:\s*retrospective[\s\S]*\r?\n---/);
  });

  it('pins the read-only clause, the placeholder set, and the output headings', () => {
    assertTemplateShape(template);
  });

  it('rejects a template that drops the read-only ground-rules section', () => {
    const mutated = template.replace(/## Ground rules \(read-only\)[\s\S]*?(?=\n## )/, '');
    expect(() => assertTemplateShape(mutated)).toThrow();
  });

  it('rejects a template that adds an unknown {{...}} token', () => {
    const mutated = `${template}\n{{UNKNOWN}}\n`;
    expect(() => assertTemplateShape(mutated)).toThrow();
  });

  it('names every current review report form under the evidence inputs (operator review)', () => {
    // Review runs write self-review to review.md; the convoy writes
    // correctness/security/performance/requirements.md. Older runs may also
    // have synthesis.md. The retrospective must surface ALL of these or it
    // will silently drop the exact findings the report is meant to explain.
    const inputs = template.match(/## Inputs([\s\S]*?)(\n## |\s*$)/);
    expect(inputs, RAIL_MESSAGE).not.toBeNull();
    const inputsSection = inputs![1];
    for (const report of [
      'review.md',
      'correctness.md',
      'security.md',
      'performance.md',
      'requirements.md',
      '.overdeck/feedback/',
    ]) {
      expect(inputsSection, `Expected Inputs to name ${report}. ${RAIL_MESSAGE}`).toContain(report);
    }
  });

  it('routes canonical record reads through the read door (operator review)', () => {
    // Per the canonical-state single-source-of-truth rule, agents must not
    // read records/*.json directly. The prompt must point at the resolver
    // (pan records show / pan show).
    const inputs = template.match(/## Inputs([\s\S]*?)(\n## |\s*$)/);
    expect(inputs, RAIL_MESSAGE).not.toBeNull();
    const inputsSection = inputs![1];
    expect(inputsSection.toLowerCase(), RAIL_MESSAGE).toContain('pan records show');
    expect(inputsSection.toLowerCase(), RAIL_MESSAGE).toContain('pan show');
  });
});
