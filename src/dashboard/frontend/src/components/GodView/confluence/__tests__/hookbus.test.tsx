import { act, render, screen } from '@testing-library/react';
import { HOOK_INVENTORY, WIRED_HOOK_NAMES } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HookBus } from '../HookBus';
import type { HookStreamEntry } from '../useConfluenceData';

function entry(
  hookName: string,
  ts: number,
  sequence = ts,
  source: HookStreamEntry['source'] = 'hook',
): HookStreamEntry {
  return {
    sequence,
    source,
    agentId: 'agent-pan-3447',
    issueId: 'PAN-3447',
    tool: 'Bash',
    hookName,
    family: 'lifecycle',
    ts,
  };
}

function hookRow(container: HTMLElement, hookName: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-hook-name="${hookName}"]`);
  if (!row) throw new Error(`Missing hook row ${hookName}`);
  return row;
}

describe('Confluence hook bus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments matching wired rows and holds hot for exactly 420 ms', () => {
    const { container, rerender } = render(
      <HookBus entries={[entry('PreToolUse', 1), entry('SessionEnd', 2)]} />,
    );
    const preToolUse = hookRow(container, 'PreToolUse');
    const sessionEnd = hookRow(container, 'SessionEnd');

    expect(preToolUse.querySelector('.count')).toHaveTextContent('1');
    expect(preToolUse).toHaveClass('hot');
    expect(preToolUse).toHaveStyle({ '--hook-color': '#00d4ff' });
    expect(sessionEnd.querySelector('.count')).toHaveTextContent('—');
    expect(sessionEnd).not.toHaveClass('hot');
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(200));
    rerender(
      <HookBus entries={[
        entry('PreToolUse', 1),
        entry('SessionEnd', 2),
        entry('PreToolUse', 1, 3),
        entry('PostToolUse', 4),
      ]} />,
    );

    expect(preToolUse.querySelector('.count')).toHaveTextContent('2');
    expect(hookRow(container, 'PostToolUse').querySelector('.count')).toHaveTextContent('1');
    expect(preToolUse).toHaveClass('hot');
    expect(vi.getTimerCount()).toBe(2);

    act(() => vi.advanceTimersByTime(419));
    expect(preToolUse).toHaveClass('hot');
    expect(hookRow(container, 'PostToolUse')).toHaveClass('hot');

    act(() => vi.advanceTimersByTime(1));
    expect(preToolUse).not.toHaveClass('hot');
    expect(hookRow(container, 'PostToolUse')).not.toHaveClass('hot');
  });

  it('ignores lifecycle-only beats without fabricating hook counts', () => {
    const { container } = render(
      <HookBus entries={[entry('Lifecycle', 1, 1, 'lifecycle')]} />,
    );

    for (const hookName of WIRED_HOOK_NAMES) {
      expect(hookRow(container, hookName).querySelector('.count')).toHaveTextContent('0');
      expect(hookRow(container, hookName)).not.toHaveClass('hot');
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps unwired rows dotted, unchanged, and timer-free', () => {
    const { container, rerender } = render(<HookBus entries={[entry('SessionEnd', 1)]} />);
    const sessionEnd = hookRow(container, 'SessionEnd');
    expect(sessionEnd).toHaveClass('unwired');
    expect(sessionEnd.querySelector('.count')).toHaveTextContent('—');
    expect(vi.getTimerCount()).toBe(0);

    rerender(<HookBus entries={[entry('SessionEnd', 1), entry('SessionEnd', 2)]} />);
    expect(sessionEnd.querySelector('.count')).toHaveTextContent('—');
    expect(sessionEnd).not.toHaveClass('hot');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders the contracts inventory in order without frame-loop updates', () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    const { container } = render(<HookBus entries={[]} />);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-hook-name]')];

    expect(rows.map((row) => row.dataset.hookName)).toEqual(HOOK_INVENTORY.map((hook) => hook.name));
    expect(rows.filter((row) => row.dataset.wired === 'true').map((row) => row.dataset.hookName))
      .toEqual(WIRED_HOOK_NAMES);
    expect(screen.getByText(/dark fiber awaiting a producer/i)).toBeInTheDocument();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('clears every row timer on unmount', () => {
    const { unmount } = render(
      <HookBus entries={[entry('PreToolUse', 1), entry('PostToolUse', 2)]} />,
    );
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
