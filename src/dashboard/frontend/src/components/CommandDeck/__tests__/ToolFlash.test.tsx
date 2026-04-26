import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ToolFlash } from '../ToolFlash';

describe('ToolFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the current tool name', () => {
    const { getByTestId } = render(<ToolFlash currentTool="grep" />);
    expect(getByTestId('tool-flash-current').textContent).toBe('grep');
  });

  it('renders idle when currentTool is null', () => {
    const { getByTestId } = render(<ToolFlash currentTool={null} />);
    expect(getByTestId('tool-flash-current').textContent).toBe('idle');
  });

  it('starts in stable phase', () => {
    const { getByTestId } = render(<ToolFlash currentTool="grep" />);
    expect(getByTestId('tool-flash').getAttribute('data-phase')).toBe('stable');
  });

  it('transitions through cross-fade when currentTool changes', () => {
    const { rerender, getByTestId } = render(<ToolFlash currentTool="grep" />);
    rerender(<ToolFlash currentTool="rg" />);
    expect(getByTestId('tool-flash').getAttribute('data-phase')).toBe('transitioning');
    expect(getByTestId('tool-flash-prev').textContent).toBe('grep');
    expect(getByTestId('tool-flash-current').textContent).toBe('rg');
  });

  it('returns to stable after 200ms transition', () => {
    const { rerender, getByTestId, queryByTestId } = render(
      <ToolFlash currentTool="grep" />,
    );
    rerender(<ToolFlash currentTool="rg" />);
    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(getByTestId('tool-flash').getAttribute('data-phase')).toBe('stable');
    expect(queryByTestId('tool-flash-prev')).toBeNull();
    expect(getByTestId('tool-flash-current').textContent).toBe('rg');
  });

  it('does not re-trigger when re-rendered with same tool', () => {
    const { rerender, getByTestId } = render(<ToolFlash currentTool="grep" />);
    rerender(<ToolFlash currentTool="grep" />);
    expect(getByTestId('tool-flash').getAttribute('data-phase')).toBe('stable');
  });

  it('handles repeated rapid changes', () => {
    const { rerender, getByTestId } = render(<ToolFlash currentTool="grep" />);
    rerender(<ToolFlash currentTool="rg" />);
    act(() => {
      vi.advanceTimersByTime(220);
    });
    rerender(<ToolFlash currentTool="cat" />);
    expect(getByTestId('tool-flash-prev').textContent).toBe('rg');
    expect(getByTestId('tool-flash-current').textContent).toBe('cat');
  });
});
