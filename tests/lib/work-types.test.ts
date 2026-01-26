import { describe, it, expect } from 'vitest';
import {
  WORK_TYPES,
  WorkTypeId,
  WorkTypeCategory,
  getAllWorkTypes,
  getWorkTypesByCategory,
  isValidWorkType,
  getWorkTypeMetadata,
  getWorkTypeName,
  validateWorkType,
} from '../../src/lib/work-types.js';

describe('work-types', () => {
  describe('WORK_TYPES registry', () => {
    it('should have exactly 23 work types', () => {
      const workTypes = Object.keys(WORK_TYPES);
      expect(workTypes).toHaveLength(23);
    });

    it('should have all issue-agent phases', () => {
      const phases = [
        'issue-agent:exploration',
        'issue-agent:planning',
        'issue-agent:implementation',
        'issue-agent:testing',
        'issue-agent:documentation',
        'issue-agent:review-response',
      ];

      phases.forEach((phase) => {
        expect(WORK_TYPES).toHaveProperty(phase);
        expect(WORK_TYPES[phase as WorkTypeId].category).toBe('issue-agent');
      });
    });

    it('should have all specialist agents', () => {
      const specialists = [
        'specialist-review-agent',
        'specialist-test-agent',
        'specialist-merge-agent',
      ];

      specialists.forEach((specialist) => {
        expect(WORK_TYPES).toHaveProperty(specialist);
        expect(WORK_TYPES[specialist as WorkTypeId].category).toBe('specialist');
      });
    });

    it('should have all subagents', () => {
      const subagents = [
        'subagent:explore',
        'subagent:plan',
        'subagent:bash',
        'subagent:general-purpose',
      ];

      subagents.forEach((subagent) => {
        expect(WORK_TYPES).toHaveProperty(subagent);
        expect(WORK_TYPES[subagent as WorkTypeId].category).toBe('subagent');
      });
    });

    it('should have all convoy members', () => {
      const convoy = [
        'convoy:security-reviewer',
        'convoy:performance-reviewer',
        'convoy:correctness-reviewer',
        'convoy:synthesis-agent',
      ];

      convoy.forEach((member) => {
        expect(WORK_TYPES).toHaveProperty(member);
        expect(WORK_TYPES[member as WorkTypeId].category).toBe('convoy');
      });
    });

    it('should have all pre-work agents', () => {
      const preWork = [
        'prd-agent',
        'decomposition-agent',
        'triage-agent',
        'planning-agent',
      ];

      preWork.forEach((agent) => {
        expect(WORK_TYPES).toHaveProperty(agent);
        expect(WORK_TYPES[agent as WorkTypeId].category).toBe('pre-work');
      });
    });

    it('should have all CLI contexts', () => {
      const cli = ['cli:interactive', 'cli:quick-command'];

      cli.forEach((context) => {
        expect(WORK_TYPES).toHaveProperty(context);
        expect(WORK_TYPES[context as WorkTypeId].category).toBe('cli');
      });
    });

    it('should have descriptions for all work types', () => {
      Object.entries(WORK_TYPES).forEach(([id, metadata]) => {
        expect(metadata.description).toBeTruthy();
        expect(typeof metadata.description).toBe('string');
      });
    });

    it('should have phase field for issue-agent types', () => {
      const issueAgentTypes = getWorkTypesByCategory('issue-agent');

      issueAgentTypes.forEach((id) => {
        const metadata = WORK_TYPES[id];
        expect(metadata.phase).toBeDefined();
        expect(typeof metadata.phase).toBe('string');
      });
    });
  });

  describe('getAllWorkTypes', () => {
    it('should return all 23 work type IDs', () => {
      const allTypes = getAllWorkTypes();
      expect(allTypes).toHaveLength(23);
    });

    it('should return an array of strings', () => {
      const allTypes = getAllWorkTypes();
      allTypes.forEach((id) => {
        expect(typeof id).toBe('string');
      });
    });

    it('should include all categories', () => {
      const allTypes = getAllWorkTypes();
      const categories = new Set(
        allTypes.map((id) => WORK_TYPES[id].category)
      );

      expect(categories).toContain('issue-agent');
      expect(categories).toContain('specialist');
      expect(categories).toContain('subagent');
      expect(categories).toContain('convoy');
      expect(categories).toContain('pre-work');
      expect(categories).toContain('cli');
    });
  });

  describe('getWorkTypesByCategory', () => {
    it('should return 6 issue-agent types', () => {
      const types = getWorkTypesByCategory('issue-agent');
      expect(types).toHaveLength(6);
    });

    it('should return 3 specialist types', () => {
      const types = getWorkTypesByCategory('specialist');
      expect(types).toHaveLength(3);
    });

    it('should return 4 subagent types', () => {
      const types = getWorkTypesByCategory('subagent');
      expect(types).toHaveLength(4);
    });

    it('should return 4 convoy types', () => {
      const types = getWorkTypesByCategory('convoy');
      expect(types).toHaveLength(4);
    });

    it('should return 4 pre-work types', () => {
      const types = getWorkTypesByCategory('pre-work');
      expect(types).toHaveLength(4);
    });

    it('should return 2 CLI types', () => {
      const types = getWorkTypesByCategory('cli');
      expect(types).toHaveLength(2);
    });

    it('should only return types matching the category', () => {
      const categories: WorkTypeCategory[] = [
        'issue-agent',
        'specialist',
        'subagent',
        'convoy',
        'pre-work',
        'cli',
      ];

      categories.forEach((category) => {
        const types = getWorkTypesByCategory(category);
        types.forEach((id) => {
          expect(WORK_TYPES[id].category).toBe(category);
        });
      });
    });
  });

  describe('isValidWorkType', () => {
    it('should return true for valid work types', () => {
      expect(isValidWorkType('issue-agent:exploration')).toBe(true);
      expect(isValidWorkType('specialist-review-agent')).toBe(true);
      expect(isValidWorkType('convoy:security-reviewer')).toBe(true);
    });

    it('should return false for invalid work types', () => {
      expect(isValidWorkType('invalid-type')).toBe(false);
      expect(isValidWorkType('issue-agent:invalid')).toBe(false);
      expect(isValidWorkType('')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isValidWorkType('ISSUE-AGENT:EXPLORATION')).toBe(false); // Case sensitive
      expect(isValidWorkType('issue-agent:')).toBe(false);
      expect(isValidWorkType(':exploration')).toBe(false);
    });
  });

  describe('getWorkTypeMetadata', () => {
    it('should return metadata for valid work types', () => {
      const metadata = getWorkTypeMetadata('issue-agent:exploration');
      expect(metadata).toBeDefined();
      expect(metadata.category).toBe('issue-agent');
      expect(metadata.phase).toBe('exploration');
      expect(metadata.description).toBeTruthy();
    });

    it('should return metadata without phase for non-issue-agent types', () => {
      const metadata = getWorkTypeMetadata('specialist-review-agent');
      expect(metadata).toBeDefined();
      expect(metadata.category).toBe('specialist');
      expect(metadata.phase).toBeUndefined();
      expect(metadata.description).toBeTruthy();
    });

    it('should work for all 20 work types', () => {
      getAllWorkTypes().forEach((id) => {
        const metadata = getWorkTypeMetadata(id);
        expect(metadata).toBeDefined();
        expect(metadata.category).toBeTruthy();
        expect(metadata.description).toBeTruthy();
      });
    });
  });

  describe('getWorkTypeName', () => {
    it('should return formatted name for issue-agent types', () => {
      const name = getWorkTypeName('issue-agent:exploration');
      expect(name).toBe('issue-agent (exploration)');
    });

    it('should return ID for non-phase types', () => {
      const name = getWorkTypeName('specialist-review-agent');
      expect(name).toBe('specialist-review-agent');
    });

    it('should handle all work types', () => {
      getAllWorkTypes().forEach((id) => {
        const name = getWorkTypeName(id);
        expect(name).toBeTruthy();
        expect(typeof name).toBe('string');
      });
    });
  });

  describe('validateWorkType', () => {
    it('should not throw for valid work types', () => {
      expect(() => validateWorkType('issue-agent:exploration')).not.toThrow();
      expect(() => validateWorkType('specialist-review-agent')).not.toThrow();
    });

    it('should throw for invalid work types', () => {
      expect(() => validateWorkType('invalid-type')).toThrow();
      expect(() => validateWorkType('issue-agent:invalid')).toThrow();
      expect(() => validateWorkType('')).toThrow();
    });

    it('should include valid types in error message', () => {
      try {
        validateWorkType('invalid-type');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('Invalid work type ID');
        expect((err as Error).message).toContain('invalid-type');
        expect((err as Error).message).toContain('Valid types');
      }
    });

    it('should work for all valid types', () => {
      getAllWorkTypes().forEach((id) => {
        expect(() => validateWorkType(id)).not.toThrow();
      });
    });
  });

  describe('category distribution', () => {
    it('should have correct count per category', () => {
      const categories: Record<WorkTypeCategory, number> = {
        'issue-agent': 6,
        specialist: 3,
        subagent: 4,
        convoy: 4,
        'pre-work': 4,
        cli: 2,
      };

      Object.entries(categories).forEach(([category, expectedCount]) => {
        const types = getWorkTypesByCategory(category as WorkTypeCategory);
        expect(types).toHaveLength(expectedCount);
      });
    });

    it('should sum to exactly 23 work types', () => {
      const categories: WorkTypeCategory[] = [
        'issue-agent',
        'specialist',
        'subagent',
        'convoy',
        'pre-work',
        'cli',
      ];

      const total = categories.reduce((sum, category) => {
        return sum + getWorkTypesByCategory(category).length;
      }, 0);

      expect(total).toBe(23);
    });
  });
});
