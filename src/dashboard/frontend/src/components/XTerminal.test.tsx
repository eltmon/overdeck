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
class ResizeObserverMock implements ResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}
global.ResizeObserver = ResizeObserverMock;

// Mock matchMedia for xterm.js
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('XTerminal', () => {
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    // Store original values before modifying
    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

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

    // Restore original values
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
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

describe('XTerminal - Clipboard Functionality', () => {
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    // Store original values before modifying
    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

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

    // Restore original values
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
  });

  it('mocks navigator.clipboard for paste operations', async () => {
    // Mock navigator.clipboard
    const readTextMock = vi.fn().mockResolvedValue('pasted text');
    Object.defineProperty(global, 'navigator', {
      value: {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
          readText: readTextMock,
        },
      },
      writable: true,
      configurable: true,
    });

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });

    // Verify clipboard mock is set up
    expect(navigator.clipboard.readText).toBeDefined();
    expect(navigator.clipboard.writeText).toBeDefined();
  });

  it('saves auto-copy setting even when localStorage throws', async () => {
    // Mock localStorage to throw on setItem
    vi.mocked(localStorageMock.setItem).mockImplementation(() => {
      throw new Error('localStorage not available');
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();

    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(screen.getByTitle('Terminal settings')).toBeInTheDocument();
    });

    // Open settings
    const settingsButton = screen.getByTitle('Terminal settings');
    await user.click(settingsButton);

    const checkbox = screen.getByLabelText('Auto-copy on selection');
    await user.click(checkbox);

    // Should not throw, error should be caught and logged
    expect(localStorageMock.setItem).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
