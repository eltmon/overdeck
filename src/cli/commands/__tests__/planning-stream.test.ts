import { describe, expect, it } from 'vitest';

import { buildStartPlanningBody } from '../planning-stream.js';

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
