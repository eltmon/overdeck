import { describe, it, expect } from 'vitest';
import { KNOWN_HARNESSES } from '@overdeck/contracts';
import { normalizeHarness } from '../conversations.js';

describe('normalizeHarness', () => {
  it("normalizes legacy 'pi' to 'ohmypi'", () => {
    expect(normalizeHarness('pi')).toBe('ohmypi');
  });

  it("accepts 'ohmypi' and returns it unchanged", () => {
    expect(normalizeHarness('ohmypi')).toBe('ohmypi');
  });

  it("accepts 'claude-code' and returns it unchanged", () => {
    expect(normalizeHarness('claude-code')).toBe('claude-code');
  });

  it("accepts 'codex' and returns it unchanged", () => {
    expect(normalizeHarness('codex')).toBe('codex');
  });

  it("accepts 'acp' and returns it unchanged", () => {
    expect(normalizeHarness('acp')).toBe('acp');
  });

  it("accepts 'kimi-code' and returns it unchanged", () => {
    expect(normalizeHarness('kimi-code')).toBe('kimi-code');
  });

  it('returns null for unknown harness values', () => {
    expect(normalizeHarness('unknown')).toBeNull();
    expect(normalizeHarness('')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeHarness(null)).toBeNull();
  });

  it('no-loss: every canonical harness normalizes to itself', () => {
    for (const harness of KNOWN_HARNESSES) {
      expect(normalizeHarness(harness)).toBe(harness);
    }
  });
});
