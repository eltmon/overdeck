/**
 * Tests for PAN-503: deriveAgentIssueId covers both work agents and planning agents.
 *
 * deriveAgentIssueId was renamed from deriveWorkAgentIssueId and its regex extended
 * to match the planning- prefix in addition to agent-.
 */

import { describe, it, expect } from 'vitest';
import { deriveAgentIssueId } from '../AgentOutputPanel';

describe('deriveAgentIssueId', () => {
  // Work agents (existing behavior must be preserved)
  it('derives issueId from work agent id: agent-pan-505 → PAN-505', () => {
    expect(deriveAgentIssueId('agent-pan-505')).toBe('PAN-505');
  });

  it('derives issueId from work agent id with uppercase prefix', () => {
    expect(deriveAgentIssueId('agent-PAN-123')).toBe('PAN-123');
  });

  it('returns agentIssueId directly when provided (work agent)', () => {
    expect(deriveAgentIssueId('agent-pan-505', 'PAN-505')).toBe('PAN-505');
  });

  // Planning agents (new behavior)
  it('derives issueId from planning agent id: planning-pan-503 → PAN-503', () => {
    expect(deriveAgentIssueId('planning-pan-503')).toBe('PAN-503');
  });

  it('derives issueId from planning agent id with multi-letter prefix', () => {
    expect(deriveAgentIssueId('planning-min-42')).toBe('MIN-42');
  });

  it('returns agentIssueId directly when provided (planning agent)', () => {
    expect(deriveAgentIssueId('planning-pan-503', 'PAN-503')).toBe('PAN-503');
  });

  // Non-matching ids
  it('returns null for specialist session names', () => {
    expect(deriveAgentIssueId('specialist-pan-review-agent')).toBeNull();
  });

  it('returns null for unrecognized id formats', () => {
    expect(deriveAgentIssueId('unknown-session')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(deriveAgentIssueId('')).toBeNull();
  });
});
