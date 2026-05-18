import { describe, it, expect } from 'vitest';
import {
  getStateLabel,
  mapGitHubStateToCanonical,
  getLinearStateName,
  findLinearStateByName,
  cleanupWorkflowLabels,
  WORKFLOW_LABELS,
  trackerStateToCanonical,
  canonicalToTrackerState,
  CANONICAL_STATES,
  STATE_TYPE_MAP,
  DEFAULT_STATE_MAPPINGS,
} from '../../src/core/state-mapping.js';

describe('state-mapping', () => {
  describe('canonical states', () => {
    it('defines verifying_on_main as a started state with a distinct color', () => {
      expect(CANONICAL_STATES).toContainEqual({
        name: 'verifying_on_main',
        type: 'started',
        description: 'Merged and awaiting verification on main',
        color: '#f59e0b',
      });
      expect(STATE_TYPE_MAP.verifying_on_main).toBe('started');
    });

    it('maps verifying_on_main to the GitHub verifying-on-main label', () => {
      expect(DEFAULT_STATE_MAPPINGS.trackers.github.stateMap.verifying_on_main).toEqual({
        status: 'open',
        label: 'verifying-on-main',
      });
    });
  });

  describe('getStateLabel', () => {
    it('should return in-progress for in_progress state', () => {
      expect(getStateLabel('in_progress')).toBe('in-progress');
    });

    it('should return in-review for in_review state', () => {
      expect(getStateLabel('in_review')).toBe('in-review');
    });

    it('should return verifying-on-main for verifying_on_main state', () => {
      expect(getStateLabel('verifying_on_main')).toBe('verifying-on-main');
    });

    it('should return done for done state', () => {
      expect(getStateLabel('done')).toBe('done');
    });

    it('should return null for backlog state', () => {
      expect(getStateLabel('backlog')).toBeNull();
    });

    it('should return null for todo state', () => {
      expect(getStateLabel('todo')).toBeNull();
    });

    it('should return null for canceled state', () => {
      expect(getStateLabel('canceled')).toBeNull();
    });
  });

  describe('mapGitHubStateToCanonical', () => {
    it('should return done for closed state regardless of labels', () => {
      expect(mapGitHubStateToCanonical('closed', [])).toBe('done');
      expect(mapGitHubStateToCanonical('closed', ['in-progress'])).toBe('done');
      expect(mapGitHubStateToCanonical('CLOSED', [])).toBe('done');
    });

    it('should return canceled for closed issues with cancel labels', () => {
      expect(mapGitHubStateToCanonical('closed', ['wontfix'])).toBe('canceled');
      expect(mapGitHubStateToCanonical('closed', ['duplicate'])).toBe('canceled');
      expect(mapGitHubStateToCanonical('closed', ['Cancelled'])).toBe('canceled');
    });

    it('should return canceled for open issues with cancel labels', () => {
      expect(mapGitHubStateToCanonical('open', ['wontfix'])).toBe('canceled');
      expect(mapGitHubStateToCanonical('open', ['duplicate'])).toBe('canceled');
    });

    it('should return verifying_on_main for open issues with verifying labels', () => {
      expect(mapGitHubStateToCanonical('open', ['verifying-on-main'])).toBe('verifying_on_main');
      expect(mapGitHubStateToCanonical('open', ['needs-close-out'])).toBe('verifying_on_main');
    });

    it('should prefer verifying_on_main over the legacy merged label on open issues', () => {
      expect(mapGitHubStateToCanonical('open', ['merged', 'verifying-on-main'])).toBe('verifying_on_main');
      expect(mapGitHubStateToCanonical('open', ['merged', 'needs-close-out'])).toBe('verifying_on_main');
    });

    it('should return done for closed issues with merged or verifying labels', () => {
      expect(mapGitHubStateToCanonical('closed', ['closed-out'])).toBe('done');
      expect(mapGitHubStateToCanonical('closed', ['merged'])).toBe('done');
      expect(mapGitHubStateToCanonical('closed', ['verifying-on-main'])).toBe('done');
    });

    it('should return in_review for done label on open issue', () => {
      expect(mapGitHubStateToCanonical('open', ['done'])).toBe('in_review');
      expect(mapGitHubStateToCanonical('open', ['completed'])).toBe('in_review');
      expect(mapGitHubStateToCanonical('open', ['status:completed'])).toBe('in_review');
    });

    it('should return in_review for review labels on open issue', () => {
      expect(mapGitHubStateToCanonical('open', ['in review'])).toBe('in_review');
      expect(mapGitHubStateToCanonical('open', ['in-review'])).toBe('in_review');
      expect(mapGitHubStateToCanonical('open', ['review'])).toBe('in_review');
      expect(mapGitHubStateToCanonical('open', ['qa'])).toBe('in_review');
    });

    it('should return in_progress for progress labels', () => {
      expect(mapGitHubStateToCanonical('open', ['in progress'])).toBe('in_progress');
      expect(mapGitHubStateToCanonical('open', ['in-progress'])).toBe('in_progress');
      expect(mapGitHubStateToCanonical('open', ['wip'])).toBe('in_progress');
    });

    it('should return backlog for backlog labels', () => {
      expect(mapGitHubStateToCanonical('open', ['backlog'])).toBe('backlog');
      expect(mapGitHubStateToCanonical('open', ['icebox'])).toBe('backlog');
    });

    it('should return todo for todo labels', () => {
      expect(mapGitHubStateToCanonical('open', ['todo'])).toBe('todo');
      expect(mapGitHubStateToCanonical('open', ['ready'])).toBe('todo');
    });

    it('should default to todo for open issue with no matching labels', () => {
      expect(mapGitHubStateToCanonical('open', [])).toBe('todo');
      expect(mapGitHubStateToCanonical('open', ['bug', 'urgent'])).toBe('todo');
    });

    it('should handle case-insensitive state matching', () => {
      expect(mapGitHubStateToCanonical('OPEN', [])).toBe('todo');
      expect(mapGitHubStateToCanonical('Open', [])).toBe('todo');
    });
  });

  describe('getLinearStateName', () => {
    it('should return correct Linear state names', () => {
      expect(getLinearStateName('backlog')).toBe('Backlog');
      expect(getLinearStateName('todo')).toBe('Todo');
      expect(getLinearStateName('in_progress')).toBe('In Progress');
      expect(getLinearStateName('in_review')).toBe('In Review');
      expect(getLinearStateName('verifying_on_main')).toBe('In Review');
      expect(getLinearStateName('done')).toBe('Done');
      expect(getLinearStateName('canceled')).toBe('Canceled');
    });
  });

  describe('findLinearStateByName', () => {
    it('should find state by exact match', () => {
      const states = [
        { id: '1', name: 'Backlog' },
        { id: '2', name: 'Todo' },
        { id: '3', name: 'In Progress' },
      ];
      expect(findLinearStateByName(states, 'Todo')).toEqual({ id: '2', name: 'Todo' });
    });

    it('should find state by case-insensitive match', () => {
      const states = [
        { id: '1', name: 'Backlog' },
        { id: '2', name: 'In Review' },
      ];
      expect(findLinearStateByName(states, 'in review')).toEqual({ id: '2', name: 'In Review' });
      expect(findLinearStateByName(states, 'IN REVIEW')).toEqual({ id: '2', name: 'In Review' });
    });

    it('should return null when state not found', () => {
      const states = [{ id: '1', name: 'Backlog' }];
      expect(findLinearStateByName(states, 'Missing')).toBeNull();
    });

    it('should return null for empty states array', () => {
      expect(findLinearStateByName([], 'Todo')).toBeNull();
    });
  });

  describe('cleanupWorkflowLabels', () => {
    it('should remove workflow labels', () => {
      const currentLabels = ['bug', 'in-progress', 'urgent'];
      const result = cleanupWorkflowLabels(currentLabels, 'todo');
      expect(result).not.toContain('in-progress');
      expect(result).toContain('bug');
      expect(result).toContain('urgent');
    });

    it('should add target state label for in_progress', () => {
      const result = cleanupWorkflowLabels(['bug'], 'in_progress');
      expect(result).toContain('in-progress');
      expect(result).toContain('bug');
    });

    it('should add target state label for in_review', () => {
      const result = cleanupWorkflowLabels(['bug'], 'in_review');
      expect(result).toContain('in-review');
      expect(result).toContain('bug');
    });

    it('should add target state label for verifying_on_main', () => {
      const result = cleanupWorkflowLabels(['bug', 'needs-close-out'], 'verifying_on_main');
      expect(result).toContain('verifying-on-main');
      expect(result).toContain('bug');
      expect(result).not.toContain('needs-close-out');
    });

    it('should add target state label for done', () => {
      const result = cleanupWorkflowLabels(['bug'], 'done');
      expect(result).toContain('done');
      expect(result).toContain('bug');
    });

    it('should not add label for states without workflow labels', () => {
      const result = cleanupWorkflowLabels(['bug'], 'backlog');
      expect(result).toEqual(['bug']);
    });

    it('should handle case-insensitive workflow label removal', () => {
      const currentLabels = ['In-Progress', 'IN REVIEW', 'Planned'];
      const result = cleanupWorkflowLabels(currentLabels, 'todo');
      expect(result).toHaveLength(0);
    });

    it('should not duplicate existing target label', () => {
      const result = cleanupWorkflowLabels(['in-progress', 'bug'], 'in_progress');
      expect(result.filter(l => l === 'in-progress')).toHaveLength(1);
    });
  });

  describe('WORKFLOW_LABELS', () => {
    it('should contain expected workflow labels', () => {
      expect(WORKFLOW_LABELS).toContain('in-progress');
      expect(WORKFLOW_LABELS).toContain('in progress');
      expect(WORKFLOW_LABELS).toContain('in-review');
      expect(WORKFLOW_LABELS).toContain('in review');
      expect(WORKFLOW_LABELS).toContain('verifying-on-main');
      expect(WORKFLOW_LABELS).toContain('needs-close-out');
      expect(WORKFLOW_LABELS).toContain('planned');
      expect(WORKFLOW_LABELS).toContain('planning');
    });
  });

  describe('trackerStateToCanonical', () => {
    it('should map Linear state names to canonical', () => {
      expect(trackerStateToCanonical('Backlog', 'linear')).toBe('backlog');
      expect(trackerStateToCanonical('Todo', 'linear')).toBe('todo');
      expect(trackerStateToCanonical('In Progress', 'linear')).toBe('in_progress');
      expect(trackerStateToCanonical('In Review', 'linear')).toBe('in_review');
      expect(trackerStateToCanonical('Done', 'linear')).toBe('done');
      expect(trackerStateToCanonical('Canceled', 'linear')).toBe('canceled');
    });

    it('should map the GitHub verifying label to verifying_on_main', () => {
      expect(trackerStateToCanonical('verifying-on-main', 'github')).toBe('verifying_on_main');
    });

    it('should use fallback heuristics for unknown states', () => {
      expect(trackerStateToCanonical('Triage', 'linear')).toBe('backlog');
      expect(trackerStateToCanonical('Ready', 'linear')).toBe('todo');
      expect(trackerStateToCanonical('Active', 'linear')).toBe('in_progress');
      expect(trackerStateToCanonical('QA', 'linear')).toBe('in_review');
      expect(trackerStateToCanonical('Completed', 'linear')).toBe('done');
      expect(trackerStateToCanonical('Wontfix', 'linear')).toBe('canceled');
    });

    it('should default to backlog for unknown states', () => {
      expect(trackerStateToCanonical('UnknownState', 'linear')).toBe('backlog');
    });
  });

  describe('canonicalToTrackerState', () => {
    it('should map canonical to Linear state names', () => {
      expect(canonicalToTrackerState('backlog', 'linear')).toBe('Backlog');
      expect(canonicalToTrackerState('todo', 'linear')).toBe('Todo');
      expect(canonicalToTrackerState('in_progress', 'linear')).toBe('In Progress');
      expect(canonicalToTrackerState('in_review', 'linear')).toBe('In Review');
      expect(canonicalToTrackerState('verifying_on_main', 'linear')).toBe('In Review');
      expect(canonicalToTrackerState('done', 'linear')).toBe('Done');
      expect(canonicalToTrackerState('canceled', 'linear')).toBe('Canceled');
    });

    it('should return canonical state name for unknown tracker', () => {
      expect(canonicalToTrackerState('in_progress', 'unknown' as any)).toBe('in_progress');
    });
  });
});
