import { describe, expect, it } from 'vitest';

import { buildPanStartArgs } from '../agents.js';

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
});
