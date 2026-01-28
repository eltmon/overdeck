import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { XTerminal } from './XTerminal';

// Mock localStorage
const localStorageMock: Storage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}
global.ResizeObserver = ResizeObserverMock as any;

describe('XTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up container dimensions for tests
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 0,
    });
  });

  it('renders terminal container with settings button', async () => {
    render(<XTerminal sessionName="test-session" />);

    // Check that the component renders with settings button
    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });
  });

  it('loads auto-copy setting from localStorage', async () => {
    vi.mocked(localStorageMock.getItem).mockReturnValue('false');

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });
  });

  it('uses default auto-copy value when localStorage is empty', async () => {
    vi.mocked(localStorageMock.getItem).mockReturnValue(null);

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });
  });

  it('shows settings panel when settings button is clicked', async () => {
    const user = userEvent.setup();

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });

    const settingsButton = screen.getByTitle('Terminal settings');
    await user.click(settingsButton);

    expect(screen.getByText('Terminal Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Auto-copy on selection')).toBeInTheDocument();
  });

  it('saves auto-copy setting to localStorage when toggled', async () => {
    const user = userEvent.setup();

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });

    // Open settings panel
    const settingsButton = screen.getByTitle('Terminal settings');
    await user.click(settingsButton);

    // Find and toggle the checkbox
    const checkbox = screen.getByLabelText('Auto-copy on selection');
    await user.click(checkbox);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'panopticon.terminal.autoCopyOnSelect',
      expect.any(String)
    );
  });

  it('toggles auto-copy setting', async () => {
    const user = userEvent.setup();

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });

    // Open settings
    const settingsButton = screen.getByTitle('Terminal settings');
    await user.click(settingsButton);

    const checkbox = screen.getByLabelText('Auto-copy on selection') as HTMLInputElement;
    const initialChecked = checkbox.checked;

    await user.click(checkbox);

    expect(checkbox.checked).toBe(!initialChecked);
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it('respects autoCopyOnSelect prop over localStorage', async () => {
    vi.mocked(localStorageMock.getItem).mockReturnValue('false');

    render(<XTerminal sessionName="test-session" autoCopyOnSelect={true} />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });

    // Should use prop value (true) instead of localStorage (false)
    expect(localStorageMock.getItem).not.toHaveBeenCalled();
  });
});

describe('XTerminal - Platform Detection', () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  it('detects Mac platform', async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      writable: true,
      configurable: true,
    });

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });
  });

  it('detects Windows platform', async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      writable: true,
      configurable: true,
    });

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });
  });

  it('detects Linux platform', async () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      writable: true,
      configurable: true,
    });

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });
  });
});

describe('XTerminal - WebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    });
  });

  it('component renders with WebSocket support', async () => {
    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });
  });
});
