/**
 * PAN-4753 WI-10: the 9-step merge tracker marks done, current, failed and
 * pending steps for every step index.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MergeStepTracker, stepMarkers } from '../MergeStepTracker';
import { MERGE_STEPS } from '../trainCopy';

describe('stepMarkers', () => {
  MERGE_STEPS.forEach((step, index) => {
    it(`step ${index + 1} (${step.key}) in progress: earlier done, later pending`, () => {
      const markers = stepMarkers(step.key, false);
      expect(markers.slice(0, index).every((m) => m === 'done')).toBe(true);
      expect(markers[index]).toBe('current');
      expect(markers.slice(index + 1).every((m) => m === 'pending')).toBe(true);
    });

    it(`step ${index + 1} (${step.key}) failed: that step is failed`, () => {
      const markers = stepMarkers(step.key, true);
      expect(markers[index]).toBe('failed');
      expect(markers.filter((m) => m === 'failed')).toHaveLength(1);
    });
  });

  it('no step yet: everything pending', () => {
    expect(stepMarkers(null, false).every((m) => m === 'pending')).toBe(true);
  });
});

describe('MergeStepTracker', () => {
  it('renders all nine labels and the failure notes', () => {
    render(<MergeStepTracker step="squash-merging" failed notes="GitHub refused the merge: base branch moved" />);
    for (const step of MERGE_STEPS) expect(screen.getByText(step.label)).toBeTruthy();
    const failed = document.querySelector('[data-step="squash-merging"]');
    expect(failed?.getAttribute('data-marker')).toBe('failed');
    expect(document.querySelector('[data-step="rebasing"]')?.getAttribute('data-marker')).toBe('done');
    expect(document.querySelector('[data-step="post-merge-cleanup"]')?.getAttribute('data-marker')).toBe('pending');
    expect(screen.getByText('GitHub refused the merge: base branch moved')).toBeTruthy();
  });
});
