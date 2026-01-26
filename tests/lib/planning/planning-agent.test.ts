import { describe, it, expect } from 'vitest';
import { validatePlanningDocument } from '../../../src/lib/planning/planning-agent.js';

describe('planning-agent', () => {
  describe('validatePlanningDocument', () => {
    it('should accept complete planning document', () => {
      const content = `
# Planning: PAN-123

## Approach

We will build this using a three-tier architecture.

### High-Level Strategy

Use React for frontend and Node.js for backend.

## Architecture

### System Components

- Frontend (React)
- Backend (Express)
- Database (PostgreSQL)

## Technology Decisions

### Languages & Frameworks

TypeScript, React, Express

## Key Design Decisions

### Decision 1: Use REST API

We chose REST over GraphQL for simplicity.
`;

      const result = validatePlanningDocument(content);

      expect(result.complete).toBe(true);
      expect(result.missingSections).toHaveLength(0);
    });

    it('should detect missing Approach section', () => {
      const content = `
# Planning: PAN-123

## Architecture

Some architecture details

## Technology Decisions

Some tech decisions

## Key Design Decisions

Some decisions
`;

      const result = validatePlanningDocument(content);

      expect(result.complete).toBe(false);
      expect(result.missingSections).toContain('Approach');
    });

    it('should detect missing Architecture section', () => {
      const content = `
# Planning: PAN-123

## Approach

Some approach

## Technology Decisions

Some tech decisions

## Key Design Decisions

Some decisions
`;

      const result = validatePlanningDocument(content);

      expect(result.complete).toBe(false);
      expect(result.missingSections).toContain('Architecture');
    });

    it('should detect missing Technology Decisions section', () => {
      const content = `
# Planning: PAN-123

## Approach

Some approach

## Architecture

Some architecture

## Key Design Decisions

Some decisions
`;

      const result = validatePlanningDocument(content);

      expect(result.complete).toBe(false);
      expect(result.missingSections).toContain('Technology Decisions');
    });

    it('should detect missing Key Design Decisions section', () => {
      const content = `
# Planning: PAN-123

## Approach

Some approach

## Architecture

Some architecture

## Technology Decisions

Some tech decisions
`;

      const result = validatePlanningDocument(content);

      expect(result.complete).toBe(false);
      expect(result.missingSections).toContain('Key Design Decisions');
    });

    it('should count open questions', () => {
      const content = `
# Planning: PAN-123

## Approach

Some approach

## Architecture

Some architecture

## Technology Decisions

Some tech decisions

## Key Design Decisions

Some decisions

## Open Questions

- What database should we use?
- Should we use GraphQL or REST?
- How should we handle authentication?
`;

      const result = validatePlanningDocument(content);

      expect(result.openQuestions).toBe(3);
      expect(result.complete).toBe(false); // Not complete if there are open questions
    });

    it('should flag many unfilled sections as incomplete', () => {
      const content = `
# Planning: PAN-123

## Approach

_To be filled in_

## Architecture

_To be filled in_

## Technology Decisions

_To be filled in_

## Key Design Decisions

_To be filled in_
`;

      const result = validatePlanningDocument(content);

      expect(result.complete).toBe(false);
      expect(result.missingSections.some(s => s.includes('unfilled'))).toBe(true);
    });

    it('should accept document with few unfilled placeholders', () => {
      const content = `
# Planning: PAN-123

## Approach

We will use a microservices architecture.

_To be filled in_

## Architecture

Service-oriented design

## Technology Decisions

TypeScript, React, Node.js

## Key Design Decisions

Use REST API
`;

      const result = validatePlanningDocument(content);

      // Should be complete - only 2 "To be filled in" placeholders (threshold is 2)
      expect(result.complete).toBe(true);
    });

    it('should handle empty document', () => {
      const content = '';

      const result = validatePlanningDocument(content);

      expect(result.complete).toBe(false);
      expect(result.missingSections.length).toBeGreaterThan(0);
    });

    it('should report zero open questions when section is empty', () => {
      const content = `
# Planning: PAN-123

## Approach

Some approach

## Architecture

Some architecture

## Technology Decisions

Some tech decisions

## Key Design Decisions

Some decisions

## Open Questions

`;

      const result = validatePlanningDocument(content);

      expect(result.openQuestions).toBe(0);
    });
  });
});
