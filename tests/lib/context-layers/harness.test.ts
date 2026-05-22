/**
 * Harness templating engine (PAN-1201).
 */

import { describe, it, expect } from 'vitest';
import { renderForHarness, validateTemplate } from '../../../src/lib/context-layers/harness.js';

describe('renderForHarness', () => {
  it('keeps always-on content for every harness', () => {
    expect(renderForHarness('Always here.', 'claude-code')).toBe('Always here.');
    expect(renderForHarness('Always here.', 'pi')).toBe('Always here.');
  });

  it('keeps a claude block for claude-code and drops it for pi', () => {
    const c = 'A\n{{#harness:claude}}\nclaude-only\n{{/harness:claude}}\nB';
    expect(renderForHarness(c, 'claude-code')).toContain('claude-only');
    expect(renderForHarness(c, 'pi')).not.toContain('claude-only');
  });

  it('keeps a pi block for pi and drops it for claude-code', () => {
    const c = '{{#harness:pi}}pi-only{{/harness:pi}}';
    expect(renderForHarness(c, 'pi')).toContain('pi-only');
    expect(renderForHarness(c, 'claude-code')).not.toContain('pi-only');
  });

  it('renders a stacked claude+pi block for both harnesses (union)', () => {
    const c = '{{#harness:claude}}{{#harness:pi}}\nshared\n{{/harness:claude}}{{/harness:pi}}';
    expect(renderForHarness(c, 'claude-code')).toContain('shared');
    expect(renderForHarness(c, 'pi')).toContain('shared');
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
    const c = 'A\n\n{{#harness:pi}}\npi\n{{/harness:pi}}\n\nB';
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
    const v = validateTemplate('{{#harness:codex}}x{{/harness:codex}}');
    expect(v.ok).toBe(true);
    expect(v.issues.some((i) => i.severity === 'warning' && /codex/.test(i.message))).toBe(true);
  });
});
