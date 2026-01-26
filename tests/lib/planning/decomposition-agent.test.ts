import { describe, it, expect } from 'vitest';
import { validateTaskDependencies } from '../../../src/lib/planning/decomposition-agent.js';
import type { Task } from '../../../src/lib/planning/decomposition-agent.js';

describe('decomposition-agent', () => {
  describe('validateTaskDependencies', () => {
    it('should return valid=true for tasks with no dependencies', () => {
      const tasks: Task[] = [
        { name: 'Task 1', description: 'First task' },
        { name: 'Task 2', description: 'Second task' },
        { name: 'Task 3', description: 'Third task' },
      ];

      const result = validateTaskDependencies(tasks);

      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
    });

    it('should return valid=true for tasks with acyclic dependencies', () => {
      const tasks: Task[] = [
        { name: 'Task 1', description: 'First task' },
        { name: 'Task 2', description: 'Second task', dependsOn: ['Task 1'] },
        { name: 'Task 3', description: 'Third task', dependsOn: ['Task 2'] },
      ];

      const result = validateTaskDependencies(tasks);

      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
    });

    it('should detect simple circular dependency (A -> B -> A)', () => {
      const tasks: Task[] = [
        { name: 'Task A', description: 'First task', dependsOn: ['Task B'] },
        { name: 'Task B', description: 'Second task', dependsOn: ['Task A'] },
      ];

      const result = validateTaskDependencies(tasks);

      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should detect complex circular dependency (A -> B -> C -> A)', () => {
      const tasks: Task[] = [
        { name: 'Task A', description: 'First task', dependsOn: ['Task B'] },
        { name: 'Task B', description: 'Second task', dependsOn: ['Task C'] },
        { name: 'Task C', description: 'Third task', dependsOn: ['Task A'] },
      ];

      const result = validateTaskDependencies(tasks);

      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
      // Cycle should contain Task A, B, and C
      const cycle = result.cycles[0];
      expect(cycle).toContain('Task A');
    });

    it('should detect self-dependency', () => {
      const tasks: Task[] = [
        { name: 'Task 1', description: 'First task' },
        { name: 'Task 2', description: 'Second task', dependsOn: ['Task 2'] }, // Self-dependency
      ];

      const result = validateTaskDependencies(tasks);

      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should handle multiple independent dependency chains', () => {
      const tasks: Task[] = [
        { name: 'Chain 1 - Task A', description: 'First chain, first task' },
        { name: 'Chain 1 - Task B', description: 'First chain, second task', dependsOn: ['Chain 1 - Task A'] },
        { name: 'Chain 2 - Task A', description: 'Second chain, first task' },
        { name: 'Chain 2 - Task B', description: 'Second chain, second task', dependsOn: ['Chain 2 - Task A'] },
      ];

      const result = validateTaskDependencies(tasks);

      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
    });

    it('should handle complex DAG with multiple dependencies', () => {
      const tasks: Task[] = [
        { name: 'Task 1', description: 'First task' },
        { name: 'Task 2', description: 'Second task' },
        { name: 'Task 3', description: 'Third task', dependsOn: ['Task 1', 'Task 2'] },
        { name: 'Task 4', description: 'Fourth task', dependsOn: ['Task 3'] },
      ];

      const result = validateTaskDependencies(tasks);

      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
    });

    it('should handle empty task list', () => {
      const tasks: Task[] = [];

      const result = validateTaskDependencies(tasks);

      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
    });

    it('should ignore missing dependencies (not checked by this function)', () => {
      // Note: validateTaskDependencies only checks for cycles, not existence
      const tasks: Task[] = [
        { name: 'Task 1', description: 'First task', dependsOn: ['NonExistent Task'] },
        { name: 'Task 2', description: 'Second task' },
      ];

      const result = validateTaskDependencies(tasks);

      // Should be valid because there's no cycle (NonExistent Task is treated as a leaf)
      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
    });
  });
});
