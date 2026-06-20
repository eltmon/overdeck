import { describe, it, expect } from 'vitest';
import { reviewResumeDecision } from '../review-resume-decision.js';

/**
 * PAN-1862 regression lock. The review pipeline MUST resume the saved review session by default
 * (preserving the prior review's context so a re-review checks the fix instead of re-researching
 * the whole diff) and fresh-spawn ONLY when the harness/model actually changed. This is the
 * single decision both quick review (the parent) and convoy (the sub-reviewers) consult — if it
 * regresses to "always fresh", reviews start re-researching every round and burn tokens (the exact
 * problem PAN-1862 fixed). These cases pin every branch.
 */
describe('reviewResumeDecision (PAN-1862 — resume by default, fresh only on change)', () => {
  const base = { hasSavedState: true, hasSavedSession: true } as const;

  describe('RESUMES (preserves context)', () => {
    it('same model, same harness, saved session present', () => {
      expect(reviewResumeDecision({
        ...base, requestedModel: 'gpt-5.5', requestedHarness: 'codex', savedModel: 'gpt-5.5', savedHarness: 'codex',
      })).toBe(true);
    });

    it('no model/harness requested (use role default) with a saved session — the common re-review', () => {
      expect(reviewResumeDecision({ ...base, savedModel: 'gpt-5.5', savedHarness: 'codex' })).toBe(true);
    });

    it('requested model but saved model unknown — a change cannot be proven, so do NOT force a wipe', () => {
      expect(reviewResumeDecision({ ...base, requestedModel: 'gpt-5.5' })).toBe(true);
    });

    it('saved model known but no model requested — use-default is not a change', () => {
      expect(reviewResumeDecision({ ...base, savedModel: 'gpt-5.5', savedHarness: 'codex' })).toBe(true);
    });

    it('same model with only a harness difference that is unknown on one side', () => {
      expect(reviewResumeDecision({
        ...base, requestedModel: 'gpt-5.5', savedModel: 'gpt-5.5', requestedHarness: 'codex',
      })).toBe(true);
    });
  });

  describe('FRESH-SPAWNS (model/harness changed, or nothing to resume)', () => {
    it('model changed (gpt-5.5 → opus)', () => {
      expect(reviewResumeDecision({
        ...base, requestedModel: 'claude-opus-4-8', savedModel: 'gpt-5.5', requestedHarness: 'codex', savedHarness: 'codex',
      })).toBe(false);
    });

    it('harness changed (codex → claude-code)', () => {
      expect(reviewResumeDecision({
        ...base, requestedModel: 'gpt-5.5', savedModel: 'gpt-5.5', requestedHarness: 'claude-code', savedHarness: 'codex',
      })).toBe(false);
    });

    it('no saved agent state — first review of the issue', () => {
      expect(reviewResumeDecision({
        hasSavedState: false, hasSavedSession: false, requestedModel: 'gpt-5.5', savedModel: undefined,
      })).toBe(false);
    });

    it('saved state but no resumable session id — cannot resume', () => {
      expect(reviewResumeDecision({
        hasSavedState: true, hasSavedSession: false, requestedModel: 'gpt-5.5', savedModel: 'gpt-5.5',
      })).toBe(false);
    });

    it('both model AND harness changed', () => {
      expect(reviewResumeDecision({
        ...base, requestedModel: 'claude-opus-4-8', savedModel: 'gpt-5.5', requestedHarness: 'claude-code', savedHarness: 'codex',
      })).toBe(false);
    });
  });
});
