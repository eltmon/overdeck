import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SendModeMenu, type DeliverAs } from '../SendModeMenu';

// PAN-5295 WI-7 (D2-11): the composer's Send menu.

function renderMenu(props: Partial<React.ComponentProps<typeof SendModeMenu>> = {}) {
  const onChange = vi.fn<(value: DeliverAs) => void>();
  render(<SendModeMenu value="auto" onChange={onChange} steerKind="send-now-keys" sessionAlive {...props} />);
  return { onChange };
}

const button = (): HTMLElement => screen.getByRole('button', { name: /^Send:/ });

function labels(): string[] {
  fireEvent.click(button());
  return screen.getAllByRole('menuitemradio').map((item) => item.querySelector('.font-medium')?.textContent ?? '');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SendModeMenu', () => {
  it('reads Send: <mode> with the busy-agent title and a menu popup', () => {
    renderMenu({ value: 'steer' });
    expect(button()).toHaveTextContent('Send: interrupt now');
    expect(button()).toHaveAttribute('title', 'How your message reaches a busy agent');
    expect(button()).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('lists normally and interrupt now for Claude Code', () => {
    renderMenu();
    expect(labels()).toEqual(['normally', 'interrupt now']);
  });

  it('adds after this turn for Pi (control channel)', () => {
    renderMenu({ steerKind: 'control-channel' });
    expect(labels()).toEqual(['normally', 'interrupt now', 'after this turn']);
  });

  it('adds when the limit resets when scheduling is available', () => {
    renderMenu({ scheduleAvailable: true });
    expect(labels()).toEqual(['normally', 'interrupt now', 'when the limit resets']);
  });

  it('marks the current mode checked and describes each mode', () => {
    renderMenu({ value: 'steer', steerKind: 'control-channel' });
    fireEvent.click(button());
    const steer = screen.getByRole('menuitemradio', { name: /^interrupt now/ });
    expect(steer).toHaveAttribute('aria-checked', 'true');
    expect(steer).toHaveTextContent('Stops the current turn and sends now.');
    expect(steer).toHaveAttribute('title', expect.stringContaining('interrupt the current turn'));
    expect(screen.getByRole('menuitemradio', { name: /^normally/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemradio', { name: /^after this turn/ })).toHaveTextContent('Waits until the current turn ends.');
  });

  it('shows Ctrl Enter on the interrupt item, or ⌘ Enter on a Mac', () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'Linux x86_64' });
    renderMenu();
    fireEvent.click(button());
    expect(screen.getByRole('menuitemradio', { name: /^interrupt now/ })).toHaveTextContent('Ctrl Enter');
    cleanup();
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel' });
    renderMenu();
    fireEvent.click(button());
    expect(screen.getByRole('menuitemradio', { name: /^interrupt now/ })).toHaveTextContent('⌘ Enter');
  });

  it('calls onChange with the chosen value and closes', () => {
    const { onChange } = renderMenu({ steerKind: 'control-channel', scheduleAvailable: true });
    fireEvent.click(button());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^after this turn/ }));
    expect(onChange).toHaveBeenLastCalledWith('follow_up');
    expect(screen.queryByRole('menu', { name: 'Send' })).toBeNull();
    fireEvent.click(button());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^when the limit resets/ }));
    expect(onChange).toHaveBeenLastCalledWith('when_limit_resets');    fireEvent.click(button());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^interrupt now/ }));
    expect(onChange).toHaveBeenLastCalledWith('steer');
  });

  it('is disabled when the session is not alive', () => {
    renderMenu({ sessionAlive: false });
    expect(button()).toBeDisabled();
  });
});
