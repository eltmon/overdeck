/**
 * Route-level test for Rally child-story mapping into planning context.
 */
import { describe, it, expect } from 'vitest';
import { buildChildStoriesFromRally } from '../issues.js';

describe('buildChildStoriesFromRally', () => {
  it('maps status from the service contract exactly', () => {
    const children = [
      { ref: 'US123', title: 'Build widget', status: 'In-Progress', description: 'Do it' },
      { ref: 'US124', title: 'Test widget', status: 'Completed', description: '' },
    ] as const;

    const result = buildChildStoriesFromRally(children);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      ref: 'US123',
      title: 'Build widget',
      status: 'In-Progress',
      description: 'Do it',
    });
    expect(result[1]).toEqual({
      ref: 'US124',
      title: 'Test widget',
      status: 'Completed',
      description: '',
    });
  });

  it('normalizes missing description to empty string', () => {
    const children = [
      { ref: 'US125', title: 'Fix bug', status: 'Defined', description: undefined as unknown as string },
    ];

    const result = buildChildStoriesFromRally(children);

    expect(result[0].description).toBe('');
  });

  it('returns empty array for empty input', () => {
    expect(buildChildStoriesFromRally([])).toEqual([]);
  });
});
