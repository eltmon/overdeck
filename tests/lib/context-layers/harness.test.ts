/**
 * Harness templating engine (PAN-1201).
 */

import { describe, it, expect } from 'vitest';
import { renderForHarness, validateTemplate } from '../../../src/lib/context-layers/harness.js';

describe('renderForHarness', () => {
  it('keeps always-on content for every harness', () => {
    expect(renderForHarness('Always here.', 'claude-code')).toBe('Always here.');
    expect(renderForHarness('Always here.', 'ohmypi')).toBe('Always here.');
  });

  it('keeps a claude block for claude-code and drops it for ohmypi', () => {
    const c = 'A\n{{#harness:claude}}\nclaude-only\n{{/harness:claude}}\nB';
    expect(renderForHarness(c, 'claude-code')).toContain('claude-only');
    expect(renderForHarness(c, 'ohmypi')).not.toContain('claude-only');
  });

  it('keeps an ohmypi block for ohmypi and drops it for claude-code', () => {
    const c = '{{#harness:ohmypi}}ohmypi-only{{/harness:ohmypi}}';
    expect(renderForHarness(c, 'ohmypi')).toContain('ohmypi-only');
    expect(renderForHarness(c, 'claude-code')).not.toContain('ohmypi-only');
  });

  it('renders a stacked claude+ohmypi block for both harnesses (union)', () => {
    const c = '{{#harness:claude}}{{#harness:ohmypi}}\nshared\n{{/harness:claude}}{{/harness:ohmypi}}';
    expect(renderForHarness(c, 'claude-code')).toContain('shared');
    expect(renderForHarness(c, 'ohmypi')).toContain('shared');
  });

  it('strips every harness marker from the output', () => {
    const rendered = renderForHarness('{{#harness:claude}}x{{/harness:claude}}', 'claude-code');
    expect(rendered).not.toContain('{{#harness');
    expect(rendered).not.toContain('{{/harness');
    expect(rendered.trim()).toBe('x');
  });

  it('excludes an unknown-harness block when rendering for a known harness', () => {
    const c = '{{#harness:codex}}codex-only{{/harness:codex}}';
    expect(renderForHarness(c, 'claude-code')).not.toContain('codex-only');
  });

  it('collapses blank-line runs left by a removed block', () => {
    const c = 'A\n\n{{#harness:ohmypi}}\nohmypi\n{{/harness:ohmypi}}\n\nB';
    expect(renderForHarness(c, 'claude-code')).not.toMatch(/\n{3,}/);
  });
});

describe('validateTemplate', () => {
  it('accepts a well-formed template', () => {
    const v = validateTemplate('{{#harness:claude}}x{{/harness:claude}}\n{{#harness:pi}}y{{/harness:pi}}');
    expect(v.ok).toBe(true);
    expect(v.issues).toHaveLength(0);
  });

  it('flags an unclosed block as an error', () => {
    const v = validateTemplate('{{#harness:claude}}x');
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.severity === 'error' && /unclosed/.test(i.message))).toBe(true);
  });

  it('flags a stray closing marker as an error', () => {
    const v = validateTemplate('x{{/harness:pi}}');
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('warns — but does not error — on an unknown harness name', () => {
    const v = validateTemplate('{{#harness:cursor}}x{{/harness:cursor}}');
    expect(v.ok).toBe(true);
    expect(v.issues.some((i) => i.severity === 'warning' && /cursor/.test(i.message))).toBe(true);
  });

  it('does not warn on the codex harness name (now a known harness)', () => {
    const v = validateTemplate('{{#harness:codex}}x{{/harness:codex}}');
    expect(v.ok).toBe(true);
    expect(v.issues.some((i) => i.severity === 'warning' && /codex/.test(i.message))).toBe(false);
  });
});
