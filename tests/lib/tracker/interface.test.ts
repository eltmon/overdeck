import { describe, it, expect } from 'vitest';
import {
  NotImplementedError,
  IssueNotFoundError,
  TrackerAuthError,
} from '../../../src/lib/tracker/interface.js';

// PAN-1249: tracker errors migrated to Data.TaggedError. Constructors take
// structured objects instead of positional strings, and surface tag/payload
// via `_tag` + the typed fields rather than a templated `message`.
describe('Tracker Errors', () => {
  describe('NotImplementedError', () => {
    it('should create error with feature payload', () => {
      const error = new NotImplementedError({ feature: 'GitLab tracker' });
      expect(error._tag).toBe('NotImplementedError');
      expect(error.feature).toBe('GitLab tracker');
    });
  });

  describe('IssueNotFoundError', () => {
    it('should create error with issue id and tracker', () => {
      const error = new IssueNotFoundError({ id: 'MIN-123', tracker: 'linear' });
      expect(error._tag).toBe('IssueNotFoundError');
      expect(error.id).toBe('MIN-123');
      expect(error.tracker).toBe('linear');
    });
  });

  describe('TrackerAuthError', () => {
    it('should create error with tracker and message', () => {
      const error = new TrackerAuthError({ tracker: 'github', message: 'Token expired' });
      expect(error._tag).toBe('TrackerAuthError');
      expect(error.tracker).toBe('github');
      expect(error.message).toBe('Token expired');
    });
  });
});
