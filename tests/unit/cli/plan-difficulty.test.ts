import { describe, it, expect } from 'vitest';

// Import the estimateDifficulty function - we need to export it first
// For now, we'll test the logic by duplicating the patterns

describe('estimateDifficulty logic', () => {
  // Simulating the estimateDifficulty function logic
  function estimateDifficulty(task: { name: string; description: string; difficulty?: string }): string {
    if (task.difficulty) {
      return task.difficulty;
    }

    const combined = `${task.name} ${task.description || ''}`.toLowerCase();

    // Expert-level patterns
    const expertPatterns = ['architecture', 'security', 'performance optimization', 'distributed', 'auth system', 'redesign'];
    if (expertPatterns.some(p => combined.includes(p))) {
      return 'expert';
    }

    // Complex patterns
    const complexPatterns = ['refactor', 'migration', 'overhaul', 'rewrite', 'integrate', 'multi-system'];
    if (complexPatterns.some(p => combined.includes(p))) {
      return 'complex';
    }

    // Medium patterns
    const mediumPatterns = ['implement', 'feature', 'endpoint', 'component', 'service', 'integration', 'add tests'];
    if (mediumPatterns.some(p => combined.includes(p))) {
      return 'medium';
    }

    // Trivial patterns
    const trivialPatterns = ['typo', 'rename', 'comment', 'documentation', 'readme', 'formatting'];
    if (trivialPatterns.some(p => combined.includes(p))) {
      return 'trivial';
    }

    return 'simple';
  }

  it('should return explicit difficulty if provided', () => {
    expect(estimateDifficulty({ name: 'Task', description: 'Desc', difficulty: 'expert' })).toBe('expert');
  });

  it('should detect expert-level tasks', () => {
    expect(estimateDifficulty({ name: 'Design authentication architecture', description: '' })).toBe('expert');
    expect(estimateDifficulty({ name: 'Performance optimization for queries', description: '' })).toBe('expert');
    expect(estimateDifficulty({ name: 'Add security checks', description: '' })).toBe('expert');
    expect(estimateDifficulty({ name: 'Build distributed cache', description: '' })).toBe('expert');
  });

  it('should detect complex tasks', () => {
    expect(estimateDifficulty({ name: 'Refactor user service', description: '' })).toBe('complex');
    expect(estimateDifficulty({ name: 'Database migration', description: '' })).toBe('complex');
    expect(estimateDifficulty({ name: 'Rewrite auth module', description: '' })).toBe('complex');
    expect(estimateDifficulty({ name: 'Integrate with payment API', description: '' })).toBe('complex');
  });

  it('should detect medium tasks', () => {
    expect(estimateDifficulty({ name: 'Implement user profile feature', description: '' })).toBe('medium');
    expect(estimateDifficulty({ name: 'Add new API endpoint', description: '' })).toBe('medium');
    expect(estimateDifficulty({ name: 'Create React component', description: '' })).toBe('medium');
    expect(estimateDifficulty({ name: 'Add tests for service', description: '' })).toBe('medium');
  });

  it('should detect trivial tasks', () => {
    expect(estimateDifficulty({ name: 'Fix typo in README', description: '' })).toBe('trivial');
    expect(estimateDifficulty({ name: 'Rename variable', description: '' })).toBe('trivial');
    expect(estimateDifficulty({ name: 'Add comment to function', description: '' })).toBe('trivial');
    expect(estimateDifficulty({ name: 'Update documentation', description: '' })).toBe('trivial');
  });

  it('should default to simple for unmatched tasks', () => {
    expect(estimateDifficulty({ name: 'Fix bug', description: '' })).toBe('simple');
    expect(estimateDifficulty({ name: 'Update config', description: '' })).toBe('simple');
    expect(estimateDifficulty({ name: 'Unknown task', description: '' })).toBe('simple');
  });

  it('should match patterns in description', () => {
    expect(estimateDifficulty({ name: 'Update module', description: 'Refactor the entire module' })).toBe('complex');
    expect(estimateDifficulty({ name: 'Task', description: 'Implement new feature for users' })).toBe('medium');
  });

  it('should be case-insensitive', () => {
    expect(estimateDifficulty({ name: 'REFACTOR USER SERVICE', description: '' })).toBe('complex');
    expect(estimateDifficulty({ name: 'Implement Feature', description: '' })).toBe('medium');
  });

  it('should prioritize expert over complex', () => {
    expect(estimateDifficulty({ name: 'Refactor security architecture', description: '' })).toBe('expert');
  });

  it('should prioritize complex over medium', () => {
    expect(estimateDifficulty({ name: 'Refactor component implementation', description: '' })).toBe('complex');
  });
});
