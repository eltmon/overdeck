import { describe, it, expect } from 'vitest';
import { parseSpecialistAgentSession } from '../service.js';

describe('parseSpecialistAgentSession', () => {
  it('parses issue-scoped specialist sessions', () => {
    expect(parseSpecialistAgentSession('specialist-overdeck-PAN-714-review-agent')).toEqual({
      projectKey: 'overdeck',
      issueId: 'PAN-714',
      specialistType: 'review-agent',
    });
  });

  it('parses legacy project-scoped specialist sessions', () => {
    expect(parseSpecialistAgentSession('specialist-overdeck-review-agent')).toEqual({
      projectKey: 'overdeck',
      specialistType: 'review-agent',
    });
  });

  it('returns null for non-specialist sessions', () => {
    expect(parseSpecialistAgentSession('agent-pan-714')).toBeNull();
  });
});
