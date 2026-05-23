/**
 * Tests for `detectTerminalApiError` — the pane-content scanner that catches
 * non-recoverable upstream-provider failures (quota exhausted, login required,
 * 401/403). Origin: PAN-1015 review burned 30 minutes silently when Kimi
 * quota was exhausted because the reviewer pane stays alive at the input
 * prompt after an API error.
 */

import { describe, it, expect } from 'vitest';
import { detectTerminalApiErrorSync } from '../../src/lib/tmux.js';

describe('detectTerminalApiError', () => {
  it('returns null for empty input', () => {
    expect(detectTerminalApiErrorSync('')).toBeNull();
  });

  it('returns null for ordinary processing output', () => {
    const pane = [
      '✻ Brewed for 3s',
      '● Reading file src/foo.ts',
      '⎿  ok',
      '❯ ',
    ].join('\n');
    expect(detectTerminalApiErrorSync(pane)).toBeNull();
  });

  it('detects Kimi-style quota error (the PAN-1015 repro)', () => {
    const pane = [
      '  Please run /login · API Error: 403',
      '  {"error":{"type":"permission_error","message":"You\'ve reached your usage',
      '  limit for this billing cycle. Your quota will be refreshed in the next',
      '  cycle. Upgrade to get more: https://www.kimi.com/code/console"}}',
      '❯ ',
    ].join('\n');
    const result = detectTerminalApiErrorSync(pane);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('quota_exhausted');
    // Specific quota-line summary takes precedence over the generic 403 summary
    expect(result!.summary).toMatch(/billing cycle|usage limit/i);
  });

  it('detects "You\'ve hit your limit" Anthropic-style quota message', () => {
    const result = detectTerminalApiErrorSync("You've hit your limit. Upgrade plan...");
    expect(result?.kind).toBe('quota_exhausted');
  });

  it('detects credit-balance message as quota_exhausted', () => {
    const result = detectTerminalApiErrorSync('Error: Your credit balance is too low to access the API.');
    expect(result?.kind).toBe('quota_exhausted');
  });

  it('detects "Please run /login" as login_required', () => {
    const result = detectTerminalApiErrorSync('  Please run /login\n❯ ');
    expect(result?.kind).toBe('login_required');
  });

  it('detects API Error: 401 as auth_failed', () => {
    const result = detectTerminalApiErrorSync('API Error: 401 Unauthorized');
    expect(result?.kind).toBe('auth_failed');
  });

  it('detects authentication_error as auth_failed', () => {
    const result = detectTerminalApiErrorSync('{"error":{"type":"authentication_error","message":"invalid api key"}}');
    expect(result?.kind).toBe('auth_failed');
  });

  it('detects bare 403 as permission_denied when no quota line is present', () => {
    const result = detectTerminalApiErrorSync('API Error: 403 Forbidden');
    expect(result?.kind).toBe('permission_denied');
  });

  it('does NOT match transient retry messages — those belong to the deacon retry path', () => {
    // These are the patterns the deacon already nudges as "retry" — not
    // terminal failures.
    expect(detectTerminalApiErrorSync('API Error: Overloaded')).toBeNull();
    expect(detectTerminalApiErrorSync('API Error: Rate limit')).toBeNull();
    expect(detectTerminalApiErrorSync('API Error: Timed out')).toBeNull();
    expect(detectTerminalApiErrorSync('529 Overloaded')).toBeNull();
    expect(detectTerminalApiErrorSync('502 Bad Gateway')).toBeNull();
    expect(detectTerminalApiErrorSync('503 Service Unavailable')).toBeNull();
  });

  it('captures the matched line in raw for diagnostics, truncated to 240 chars', () => {
    const longLine = 'X'.repeat(500) + ' API Error: 403 ' + 'Y'.repeat(500);
    const result = detectTerminalApiErrorSync(longLine);
    expect(result).not.toBeNull();
    expect(result!.raw.length).toBeLessThanOrEqual(240);
  });

  it('reports the FIRST matching pattern when multiple apply', () => {
    // Quota-specific patterns are listed before generic 403, so the more
    // actionable summary wins.
    const pane = 'usage limit for this billing cycle\nAPI Error: 403';
    const result = detectTerminalApiErrorSync(pane);
    expect(result?.kind).toBe('quota_exhausted');
  });
});
