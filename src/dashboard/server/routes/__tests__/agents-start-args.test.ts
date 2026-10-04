import { describe, expect, it } from 'vitest';

import { buildPanStartArgs } from '../agents.js';
import { parseAgentEffortOverride } from '../agents/shared.js';

describe('agent start route pan start args', () => {
  it('omits --harness when the dashboard request did not explicitly pick one', () => {
    expect(buildPanStartArgs({
      issueId: 'PAN-1787',
      model: 'gpt-5.5',
      harness: null,
    })).toEqual(['start', 'PAN-1787', '--local', '--model', 'gpt-5.5']);
  });

  it('forwards the explicit harness value when one was selected', () => {
    expect(buildPanStartArgs({
      issueId: 'PAN-1787',
      model: 'gpt-5.5',
      harness: 'pi',
    })).toEqual(['start', 'PAN-1787', '--local', '--model', 'gpt-5.5', '--harness', 'pi']);
  });

  it('keeps host override flags independent from harness forwarding', () => {
    expect(buildPanStartArgs({
      issueId: 'PAN-1787',
      model: 'gpt-5.5',
      allowHost: true,
    })).toEqual(['start', 'PAN-1787', '--local', '--model', 'gpt-5.5', '--host', '--yes']);
  });

  it('forwards an explicit off-book override to the pan start subprocess', () => {
    expect(buildPanStartArgs({
      issueId: 'PAN-1787',
      model: 'gpt-5.5',
      offBook: true,
    })).toEqual(['start', 'PAN-1787', '--local', '--model', 'gpt-5.5', '--off-book']);
  });

  // PAN-3857: without an explicit operator-chosen model no --model is emitted,
  // so `pan start` runs tier/role resolution instead of treating a forwarded
  // default as an explicit override (and stamping it as record.workModel).
  it('omits --model when the request did not name one', () => {
    expect(buildPanStartArgs({
      issueId: 'PAN-3857',
      harness: null,
    })).toEqual(['start', 'PAN-3857', '--local']);
  });

  it('omits --model for an explicit null model while keeping other flags', () => {
    expect(buildPanStartArgs({
      issueId: 'PAN-3857',
      model: null,
      harness: 'pi',
      allowHost: true,
    })).toEqual(['start', 'PAN-3857', '--local', '--harness', 'pi', '--host', '--yes']);
  });

  // PAN-4256: an explicit operator-chosen effort forwards as --effort; no
  // effort means no flag, so `pan start` resolves roles.work.effort itself.
  it('forwards an explicit effort override', () => {
    expect(buildPanStartArgs({
      issueId: 'PAN-1',
      effort: 'low',
    })).toEqual(['start', 'PAN-1', '--local', '--effort', 'low']);
  });

  it('omits --effort when the request did not name one', () => {
    expect(buildPanStartArgs({
      issueId: 'PAN-1',
    })).toEqual(['start', 'PAN-1', '--local']);
  });
});

describe('parseAgentEffortOverride', () => {
  it('throws naming the five canonical levels for an invalid value', () => {
    expect(() => parseAgentEffortOverride('ultra')).toThrow(/low, medium, high, xhigh, max/);
  });

  it('returns undefined for undefined, null, or an empty string', () => {
    expect(parseAgentEffortOverride(undefined)).toBeUndefined();
    expect(parseAgentEffortOverride(null)).toBeUndefined();
    expect(parseAgentEffortOverride('')).toBeUndefined();
  });

  it('returns the level for a canonical value', () => {
    expect(parseAgentEffortOverride('medium')).toBe('medium');
  });
});
