import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildStartPlanningBody, printPlanningConnectionError } from '../planning-stream.js';

describe('buildStartPlanningBody', () => {
  it('sends workModel for the work agent while the planning model stays unset', () => {
    // PAN-2997: `pan start --model X` on an unplanned issue must scope X to the
    // WORK agent (persisted issue record override) and leave the planning
    // agent on the configured default — previously X leaked into `model` and
    // the planning agent took it instead.
    const body = JSON.parse(buildStartPlanningBody({
      auto: true,
      autoStart: true,
      workModel: 'kimi-k3-1m',
    }));
    expect(body.workModel).toBe('kimi-k3-1m');
    expect(body.model).toBeUndefined();
  });

  it('keeps model for explicit planning-role selection and omits absent overrides', () => {
    const body = JSON.parse(buildStartPlanningBody({
      auto: false,
      autoStart: false,
      model: 'claude-fable-5',
    }));
    expect(body.model).toBe('claude-fable-5');
    expect(body.workModel).toBeUndefined();
  });

  it('can carry both roles independently', () => {
    const body = JSON.parse(buildStartPlanningBody({
      auto: true,
      autoStart: true,
      model: 'claude-fable-5',
      workModel: 'kimi-k3-1m',
    }));
    expect(body.model).toBe('claude-fable-5');
    expect(body.workModel).toBe('kimi-k3-1m');
  });
});

describe('printPlanningConnectionError', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('prints the dashboard-down hint when fetch could not reach the server', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    printPlanningConnectionError('PAN-1', new TypeError('fetch failed'));
    expect(errors.mock.calls.flat().join('\n')).toContain('dashboard is not responding');
  });

  it('stays silent for a failure the dashboard reported (PAN-4564)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    printPlanningConnectionError('PAN-1', new Error('herdr detected no agent in pane wD:p3 within 60000ms'));
    expect(errors).not.toHaveBeenCalled();
  });
});
