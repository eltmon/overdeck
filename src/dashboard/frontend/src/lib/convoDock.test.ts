/**
 * PAN-2908 · C-CONVO — conversation dock tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useConvoDock } from './convoDock';

describe('convoDock slice (C-CONVO)', () => {
  beforeEach(() => {
    useConvoDock.setState({ items: [], expanded: false });
  });

  it('adds, dedupes, and caps at 8 items', () => {
    const { add } = useConvoDock.getState();
    for (let i = 1; i <= 10; i += 1) add(`PAN-${i}`);
    add('PAN-5'); // re-add → moves to front, no duplicate
    const items = useConvoDock.getState().items;
    expect(items).toHaveLength(8);
    expect(items[0].issueId).toBe('PAN-5');
    expect(new Set(items.map((i) => i.issueId)).size).toBe(8);
  });

  it('adding expands the rail; remove keeps the rest', () => {
    useConvoDock.getState().add('PAN-1');
    expect(useConvoDock.getState().expanded).toBe(true);
    useConvoDock.getState().add('PAN-2');
    useConvoDock.getState().remove('PAN-1');
    expect(useConvoDock.getState().items.map((i) => i.issueId)).toEqual(['PAN-2']);
  });

  it('persists to localStorage', () => {
    useConvoDock.getState().add('PAN-1');
    const raw = localStorage.getItem('overdeck:convo-dock');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).items[0].issueId).toBe('PAN-1');
  });
});
