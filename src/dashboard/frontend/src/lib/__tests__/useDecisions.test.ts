import { describe, expect, it } from 'vitest';
import { isBlockingDecision } from '../useDecisions';

describe('isBlockingDecision', () => {
  it('treats a waiting question as blocking — the agent has stopped', () => {
    expect(isBlockingDecision(['askUserQuestion'])).toBe(true);
  });

  it('treats a rate-limit modal as blocking', () => {
    expect(isBlockingDecision(['rateLimit'])).toBe(true);
  });

  /**
   * The case that started this: an interactive agent that ended its turn is
   * stopped dead until the operator replies, even though nothing "failed".
   */
  it('treats a yielded turn as blocking', () => {
    expect(isBlockingDecision(['agentTurnEnded'])).toBe(true);
  });

  it('does not treat a plan review as blocking — work continues around it', () => {
    expect(isBlockingDecision(['exitPlanMode'])).toBe(false);
  });

  /**
   * PAN-3051 — reversed. Under the PTY supervisor the agent is parked on the
   * permission modal in its own pane and cannot run another tool until someone
   * answers it, so it belongs at the top of the list with the other hard stops.
   */
  it('treats a permission request as blocking — the supervisor pane is parked on the modal', () => {
    expect(isBlockingDecision(['permissionRequest'])).toBe(true);
  });

  it('is blocking when any kind blocks', () => {
    expect(isBlockingDecision(['exitPlanMode', 'askUserQuestion'])).toBe(true);
  });

  it('is not blocking with no kinds', () => {
    expect(isBlockingDecision([])).toBe(false);
  });
});
