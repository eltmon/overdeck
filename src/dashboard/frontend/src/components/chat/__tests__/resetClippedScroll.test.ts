import { describe, expect, it } from 'vitest';
import { resetClippedAncestorScroll } from '../resetClippedScroll';

function buildTree(): { start: HTMLElement; ancestor: HTMLElement } {
  const ancestor = document.createElement('div');
  const child = document.createElement('div');
  const start = document.createElement('input');
  ancestor.appendChild(child);
  child.appendChild(start);
  document.body.appendChild(ancestor);
  return { start, ancestor };
}

describe('resetClippedAncestorScroll', () => {
  it('resets scrollLeft on a hidden-overflow ancestor', () => {
    const { start, ancestor } = buildTree();
    ancestor.style.overflowX = 'hidden';
    Object.defineProperty(ancestor, 'scrollLeft', { value: 64, writable: true });

    resetClippedAncestorScroll(start);

    expect(ancestor.scrollLeft).toBe(0);
  });

  it('preserves scrollLeft on an auto-overflow ancestor', () => {
    const { start, ancestor } = buildTree();
    ancestor.style.overflowX = 'auto';
    Object.defineProperty(ancestor, 'scrollLeft', { value: 64, writable: true });

    resetClippedAncestorScroll(start);

    expect(ancestor.scrollLeft).toBe(64);
  });

  it('preserves scrollTop on a hidden-overflow ancestor and does not throw on null', () => {
    const { start, ancestor } = buildTree();
    ancestor.style.overflowX = 'hidden';
    Object.defineProperty(ancestor, 'scrollTop', { value: 50, writable: true });

    resetClippedAncestorScroll(start);

    expect(ancestor.scrollTop).toBe(50);
    expect(() => resetClippedAncestorScroll(null)).not.toThrow();
  });
});
