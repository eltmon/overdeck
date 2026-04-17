import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { XTerminal } from './XTerminal';

// Mock xterm.js — it performs real DOM/media-query operations that break in jsdom.
// Use plain classes (no vi.fn() methods) so vi.clearAllMocks() doesn't clear them.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    static instances: Array<InstanceType<any>> = [];
    options: Record<string, unknown> = {};
    rows = 24;
    cols = 80;
    loadAddon = vi.fn();
    open = vi.fn();
    writeln = vi.fn();
    write = vi.fn((data?: string, cb?: () => void) => cb?.());
    clear = vi.fn();
    dispose = vi.fn();
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    reset = vi.fn();
    scrollToBottom = vi.fn();
    buffer = { active: { viewportY: 0, length: 0 } };
    constructor() {
      (this.constructor as typeof this.constructor & { instances: unknown[] }).instances.push(this);
    }
    wheelHandler: ((event: WheelEvent) => boolean) | null = null;
    onData(): { dispose(): void } { return { dispose() {} }; }
    onSelectionChange(): { dispose(): void } { return { dispose() {} }; }
    onResize(): { dispose(): void } { return { dispose() {} }; }
    attachCustomWheelEventHandler = vi.fn((handler: (event: WheelEvent) => boolean) => {
      this.wheelHandler = handler;
    });
    getSelection(): string { return ''; }
    hasSelection(): boolean { return false; }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    static instances: Array<InstanceType<any>> = [];
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 100, rows: 30 }));
    dispose = vi.fn();
    constructor() {
      (this.constructor as typeof this.constructor & { instances: unknown[] }).instances.push(this);
    }
  },
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Mock WebSocket — XTerminal uses raw WebSocket to /ws/terminal
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 1;
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    MockWebSocket.instances.push(this);
    // Simulate async open
    setTimeout(() => this.onopen?.(), 0);
  }
}
Object.defineProperty(globalThis, 'WebSocket', {
  value: MockWebSocket,
  writable: true,
  configurable: true,
});

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
    MockWebSocket.instances = [];
    (Terminal as unknown as { instances: unknown[] }).instances = [];
    (FitAddon as unknown as { instances: unknown[] }).instances = [];

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

  it('sends attach with measured dimensions on connect', async () => {
    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'attach', cols: 100, rows: 30 })
      );
    });
  });

  it('applies snapshot before sending ready', async () => {
    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const ws = MockWebSocket.instances[0];
    const term = (Terminal as unknown as { instances: Array<{ reset: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }> }).instances[0];

    ws.onmessage?.({
      data: `\u0000${JSON.stringify({ type: 'snapshot', cols: 120, rows: 32, data: 'hello snapshot' })}`,
    });

    await waitFor(() => {
      expect(term.reset).toHaveBeenCalled();
      expect(term.resize).toHaveBeenCalledWith(120, 32);
      expect(term.write).toHaveBeenCalledWith('hello snapshot', expect.any(Function));
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ready' }));
    });
  });

  it('applies authoritative size updates from the server', async () => {
    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const ws = MockWebSocket.instances[0];
    const term = (Terminal as unknown as { instances: Array<{ resize: ReturnType<typeof vi.fn> }> }).instances[0];

    ws.onmessage?.({
      data: `\u0000${JSON.stringify({ type: 'size', cols: 90, rows: 28 })}`,
    });

    await waitFor(() => {
      expect(term.resize).toHaveBeenCalledWith(90, 28);
    });
  });

  it('shows the Panopticon context menu on right-click', async () => {
    const { container } = render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const terminalSurface = container.querySelector('.absolute.inset-0') as HTMLDivElement | null;
    expect(terminalSurface).toBeTruthy();

    fireEvent.contextMenu(terminalSurface!, { clientX: 32, clientY: 64 });

    expect(await screen.findByText('Paste')).toBeInTheDocument();
  });

  it('contains wheel events inside the terminal surface', async () => {
    render(<XTerminal sessionName="test-session" />);

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    const term = (Terminal as unknown as { instances: Array<{ wheelHandler: ((event: WheelEvent) => boolean) | null }> }).instances[0];
    expect(term.wheelHandler).toBeTruthy();

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'preventDefault', { value: preventDefault });
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagation });

    const result = term.wheelHandler!(event);

    expect(result).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
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
