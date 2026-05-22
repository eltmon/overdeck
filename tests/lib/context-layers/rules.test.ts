/**
 * Bundled engineering rules (PAN-1201).
 */

import { describe, it, expect } from 'vitest';
import { parseRule, readBundledRules, renderBundledRules } from '../../../src/lib/context-layers/rules.js';

describe('parseRule', () => {
  it('reads scope: dev from frontmatter and strips the frontmatter from the body', () => {
    const r = parseRule('x', '---\nscope: dev\n---\nrule body');
    expect(r.scope).toBe('dev');
    expect(r.body).toBe('rule body');
  });

  it('defaults to universal when there is no frontmatter', () => {
    expect(parseRule('x', 'just a body').scope).toBe('universal');
  });

  it('defaults to universal when frontmatter has paths: but no scope:', () => {
    const r = parseRule('x', '---\npaths:\n  - "src/**"\n---\nbody');
    expect(r.scope).toBe('universal');
    expect(r.body).toBe('body');
  });
});

describe('readBundledRules', () => {
  it('reads all eight bundled rules', () => {
    const rules = readBundledRules();
    expect(rules.length).toBe(8);
    expect(rules.map((r) => r.name)).toEqual(
      expect.arrayContaining(['work-agents-via-pan', 'single-deacon-invariant', 'no-destructive-requests']),
    );
  });

  it('classifies work-agents-via-pan universal and single-deacon-invariant dev', () => {
    const rules = readBundledRules();
    expect(rules.find((r) => r.name === 'work-agents-via-pan')?.scope).toBe('universal');
    expect(rules.find((r) => r.name === 'single-deacon-invariant')?.scope).toBe('dev');
  });
});

describe('renderBundledRules', () => {
  it('omits dev-scoped rules when includeDev is false', () => {
    const out = renderBundledRules('claude-code', false);
    expect(out).toContain('Work Agents Run Through');
    expect(out).not.toContain('Single Deacon Invariant');
  });

  it('includes dev-scoped rules when includeDev is true', () => {
    const out = renderBundledRules('claude-code', true);
    expect(out).toContain('Single Deacon Invariant');
  });

  it('produces a single Panopticon Engineering Rules section', () => {
    const out = renderBundledRules('claude-code', true);
    expect(out.match(/## Panopticon Engineering Rules/g)).toHaveLength(1);
  });
});
