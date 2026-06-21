import { describe, it, expect } from 'vitest';
import { normalizeAgentId } from '../../../src/lib/agents.js';

/**
 * PAN-1866 regression: the sequencer spawns under the bare singleton ID
 * `sequencer-runner` (spawnRun creates the tmux session + agent dir from the
 * raw ID). normalizeAgentId must be a no-op for it, or message delivery and
 * state lookups target a nonexistent `agent-sequencer-runner` pane and the
 * agent sits idle with no prompt.
 */
describe('normalizeAgentId — singleton runners', () => {
  it('leaves singleton runner IDs untouched', () => {
    expect(normalizeAgentId('sequencer-runner')).toBe('sequencer-runner');
    expect(normalizeAgentId('flywheel-orchestrator')).toBe('flywheel-orchestrator');
  });

  it('still prefixes bare issue IDs with agent-', () => {
    expect(normalizeAgentId('pan-123')).toBe('agent-pan-123');
  });

  it('preserves already-prefixed IDs', () => {
    expect(normalizeAgentId('agent-pan-123')).toBe('agent-pan-123');
    expect(normalizeAgentId('strike-pan-1')).toBe('strike-pan-1');
  });
});
