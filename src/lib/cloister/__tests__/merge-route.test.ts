/**
 * PAN-4753 D4: the priority rule and the merge route rule.
 */
import { describe, expect, it } from 'vitest';
import type { UatGeneration } from '../../overdeck/merge-sync.js';
import { COMBINED_CI_DROP_PREFIX, droppedFromBatch, isHighPriorityMerge, mergeRouteFor } from '../merge-route.js';

describe('isHighPriorityMerge', () => {
  it.each([
    ['critical', ['critical']],
    ['blocks-main', ['blocks-main']],
    ['substrate-improvement + bug', ['substrate-improvement', 'bug']],
    ['P0', ['P0']],
    ['urgent', ['urgent']],
    ['case-insensitive', ['Critical']],
  ])('is high priority for %s', (_name, labels) => {
    expect(isHighPriorityMerge({ labels })).toBe(true);
  });

  it('treats a strike branch as high priority, with no labels', () => {
    expect(isHighPriorityMerge({ branch: 'strike/pan-4698', labels: [] })).toBe(true);
  });

  it.each([
    ['no labels', []],
    ['substrate-improvement alone', ['substrate-improvement']],
    ['bug alone', ['bug']],
    ['P2', ['P2']],
    ['auto-merge', ['auto-merge']],
    ['hold-for-uat', ['hold-for-uat']],
  ])('is normal priority for %s', (_name, labels) => {
    expect(isHighPriorityMerge({ branch: 'feature/pan-1', labels })).toBe(false);
  });
});

describe('mergeRouteFor', () => {
  const base = { heldForUat: false, trainOn: true, highPriority: false, droppedFromBatch: false };

  it('batches normal priority while the train is on', () => {
    expect(mergeRouteFor(base)).toBe('batch');
  });

  it('merges every PR on its own while the train is off', () => {
    expect(mergeRouteFor({ ...base, trainOn: false })).toBe('per-pr');
  });

  it('merges high priority on its own while the train is on', () => {
    expect(mergeRouteFor({ ...base, highPriority: true })).toBe('per-pr');
  });

  it('merges a member dropped from a batch on its own', () => {
    expect(mergeRouteFor({ ...base, droppedFromBatch: true })).toBe('per-pr');
  });

  it('keeps a UAT hold above priority and the train switch', () => {
    expect(mergeRouteFor({ ...base, heldForUat: true, highPriority: true })).toBe('batch');
    expect(mergeRouteFor({ ...base, heldForUat: true, trainOn: false })).toBe('batch');
  });
});

describe('droppedFromBatch', () => {
  const gen = (heldOut: UatGeneration['heldOut']) => ({ name: 'uat/pan-x', heldOut }) as unknown as UatGeneration;

  it('is true for a heldOut entry the auto-promote tick wrote', () => {
    const list = () => [gen([{ issueId: 'PAN-7', reason: `${COMBINED_CI_DROP_PREFIX} on uat/pan-x (test); PAN-7 merges on its own` }])];
    expect(droppedFromBatch('pan-7', '/repos/overdeck', { listInvalidated: list })).toBe(true);
  });

  it('ignores an assembly conflict hold-out and other issues', () => {
    const list = () => [gen([{ issueId: 'PAN-7', reason: 'merge conflict with PAN-6' }])];
    expect(droppedFromBatch('PAN-7', '/repos/overdeck', { listInvalidated: list })).toBe(false);
    expect(droppedFromBatch('PAN-8', '/repos/overdeck', { listInvalidated: list })).toBe(false);
  });

  it('is false without a project and when the read throws', () => {
    expect(droppedFromBatch('PAN-7', undefined)).toBe(false);
    expect(droppedFromBatch('PAN-7', '/repos/overdeck', { listInvalidated: () => { throw new Error('db'); } })).toBe(false);
  });
});
