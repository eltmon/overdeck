import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Debounce utility to prevent resize spam
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

interface XTerminalProps {
  sessionName: string;
  onDisconnect?: () => void;
  autoCopyOnSelect?: boolean;
}

interface TerminalSnapshotMessage {
  type: 'snapshot';
  cols: number;
  rows: number;
  data: string;
}

interface TerminalSizeMessage {
  type: 'size';
  cols: number;
  rows: number;
}

// Context menu state
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  canCopy: boolean;
}

// Storage key for auto-copy preference
const AUTOCOPY_STORAGE_KEY = 'panopticon.terminal.autoCopyOnSelect';

// Check if platform is Mac
const isMac = navigator.platform.toLowerCase().includes('mac');

export function XTerminal({ sessionName, onDisconnect, autoCopyOnSelect: autoCopyProp }: XTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteSize = useRef<{ cols: number; rows: number } | null>(null);
  const requestedSize = useRef<{ cols: number; rows: number } | null>(null);
  const readyForLiveData = useRef(false);
  const maxReconnectAttempts = 5;
  const [shouldReconnect, setShouldReconnect] = useState(true);

  // Auto-copy state from localStorage or prop
  const [autoCopyOnSelect, setAutoCopyOnSelect] = useState(() => {
    if (autoCopyProp !== undefined) return autoCopyProp;
    const stored = localStorage.getItem(AUTOCOPY_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    canCopy: false,
  });

  // Settings panel state
  const [showSettings, setShowSettings] = useState(false);

  // Store onDisconnect in a ref to avoid reconnection loops
  const onDisconnectRef = useRef(onDisconnect);
  onDisconnectRef.current = onDisconnect;

  // Persist auto-copy setting to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTOCOPY_STORAGE_KEY, String(autoCopyOnSelect));
    } catch (err) {
      console.error('Failed to save auto-copy setting:', err);
    }
  }, [autoCopyOnSelect]);

  // Calculate exponential backoff delay: 1s, 2s, 4s, 8s, max 30s
  const getReconnectDelay = (attempt: number): number => {
    return Math.min(1000 * Math.pow(2, attempt), 30000);
  };

  const getMeasuredSize = useCallback((): { cols: number; rows: number } | null => {
    const term = terminalInstance.current;
    const fit = fitAddon.current as (FitAddon & { proposeDimensions?: () => { cols: number; rows: number } | undefined }) | null;
    if (!term || !fit) return null;
    const proposed = fit.proposeDimensions?.();
    const cols = proposed?.cols ?? term.cols;
    const rows = proposed?.rows ?? term.rows;
    if (!cols || !rows) return null;
    return { cols, rows };
  }, []);

  const sendResizeIfNeeded = useCallback(() => {
    // Fit the terminal to its container so xterm.js renders at the right size.
    // Skip while the user has an active selection — fit() can call term.resize()
    // which clears the selection mid-drag (a1a91528 broke this).
    const term = terminalInstance.current;
    const fit = fitAddon.current;
    if (term && !term.hasSelection()) {
      try {
        fit?.fit();
      } catch {
        // fit() can throw if terminal isn't attached yet
      }
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !readyForLiveData.current) return;
    const measured = getMeasuredSize();
    if (!measured) return;
    const current = requestedSize.current;
    if (current?.cols === measured.cols && current.rows === measured.rows) return;
    requestedSize.current = measured;
    ws.send(JSON.stringify({ type: 'resize', cols: measured.cols, rows: measured.rows }));
  }, [getMeasuredSize]);

  // Copy selected text to clipboard
  const copySelection = useCallback(async () => {
    const term = terminalInstance.current;
    if (!term || !term.hasSelection()) return;

    const selection = term.getSelection();
    try {
      await navigator.clipboard.writeText(selection);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback to execCommand
      const textarea = document.createElement('textarea');
      textarea.value = selection;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      document.body.removeChild(textarea);
    }
  }, []);

  // Paste from clipboard
  const pasteFromClipboard = useCallback(async () => {
    const term = terminalInstance.current;
    if (!term) return;

    try {
      const text = await navigator.clipboard.readText();
      // Send pasted text to WebSocket if open
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(text);
      }
    } catch (err) {
      console.error('Failed to read from clipboard:', err);
    }
  }, []);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const term = terminalInstance.current;
    if (!term) return;

    const isCmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

    // Ctrl+C / Cmd+C: Copy if selection, else send interrupt
    if (isCmdOrCtrl && event.key.toLowerCase() === 'c') {
      if (term.hasSelection()) {
        event.preventDefault();
        copySelection();
      }
      // If no selection, let terminal handle (interrupt signal)
    }

    // Ctrl+V / Cmd+V: Paste from clipboard
    if (isCmdOrCtrl && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      pasteFromClipboard();
    }
  }, [copySelection, pasteFromClipboard]);

  // Handle context menu (right-click)
  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const term = terminalInstance.current;
    if (!term) return;

    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      canCopy: term.hasSelection(),
    });
  }, []);

  const handleTerminalWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }, []);

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  // Handle copy from context menu
  const handleContextCopy = useCallback(() => {
    copySelection();
    closeContextMenu();
  }, [copySelection, closeContextMenu]);

  // Handle paste from context menu
  const handleContextPaste = useCallback(() => {
    pasteFromClipboard();
    closeContextMenu();
  }, [pasteFromClipboard, closeContextMenu]);

  // Handle click outside context menu
  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClickOutside = () => {
      closeContextMenu();
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu.visible, closeContextMenu]);

  const connect = useCallback(() => {
    if (!terminalRef.current || !sessionName) return;

    // Clear any pending reconnect timer
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    // Ensure container has dimensions before creating terminal
    const container = terminalRef.current;
    if (container.clientWidth === 0 || container.clientHeight === 0) {
      console.warn('XTerminal: Container has no size, retrying in 100ms');
      setTimeout(() => connect(), 100);
      return;
    }

    console.log('XTerminal: Creating terminal, container size:', container.clientWidth, 'x', container.clientHeight);

    // Create terminal instance if it doesn't exist, otherwise reuse
    let term = terminalInstance.current;
    let fit = fitAddon.current;
    const handleForcedSelectionMouseDown = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      if (event.button !== 0) return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      event.stopPropagation();
      const synthetic = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        detail: event.detail,
        shiftKey: true,
      });
      target.dispatchEvent(synthetic);
    };

    if (!term) {
      term = new Terminal({
        cursorBlink: false,
        cursorStyle: 'bar',
        cursorInactiveStyle: 'none',
        fontSize: 14,
        fontFamily: "'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
        cols: 120,
        rows: 29,  // Match typical fitted size to avoid row mismatch with tmux status bar
        scrollback: 0,  // tmux is the source of truth for history; local scrollback duplicates content
        convertEol: false,  // Don't convert EOL - let escape sequences pass through raw
        scrollOnUserInput: true,
        allowProposedApi: true,
        macOptionClickForcesSelection: true,
        rightClickSelectsWord: false,
        theme: {
          background: '#1a1a2e',
          foreground: '#eaeaea',
          cursor: '#eaeaea',
          cursorAccent: '#1a1a2e',
          selectionBackground: '#3a3a5e',
          black: '#1a1a2e',
          red: '#ff5555',
          green: '#50fa7b',
          yellow: '#f1fa8c',
          blue: '#6272a4',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#f8f8f2',
          brightBlack: '#6272a4',
          brightRed: '#ff6e6e',
          brightGreen: '#69ff94',
          brightYellow: '#ffffa5',
          brightBlue: '#d6acff',
          brightMagenta: '#ff92df',
          brightCyan: '#a4ffff',
          brightWhite: '#ffffff',
        },
      });

      fit = new FitAddon();

      term.loadAddon(fit);
      term.open(terminalRef.current);
      // Fit terminal to container immediately so it uses the full width
      try { fit.fit(); } catch { /* element may not be sized yet */ }

      terminalInstance.current = term;
      fitAddon.current = fit;

      // Add selection change handler for auto-copy
      let selectionTimeout: ReturnType<typeof setTimeout> | null = null;
      term.onSelectionChange(() => {
        if (!autoCopyOnSelect || !term) return;

        // Debounce to avoid copying during drag
        if (selectionTimeout) clearTimeout(selectionTimeout);
        selectionTimeout = setTimeout(() => {
          if (term && term.hasSelection()) {
            const selection = term.getSelection();
            if (selection) {
              navigator.clipboard.writeText(selection).catch(err => {
                console.error('Auto-copy failed:', err);
              });
            }
          }
        }, 300);
      });

      // Add keyboard event listener to terminal element
      terminalRef.current.addEventListener('keydown', handleKeyDown);

      // Add right-click handler
      terminalRef.current.addEventListener('contextmenu', handleContextMenu);

      // Keep wheel/trackpad gestures contained inside the terminal surface so
      // outer browser/app-shell handlers (like chat-input history navigation)
      // never consume them while the pointer is over the terminal.
      term.attachCustomWheelEventHandler(handleTerminalWheel);

      // On Linux/non-Mac, xterm only forces selection through mouse-reporting mode
      // when Shift is held. Claude's TUI enables mouse reporting, which makes plain
      // drag-selection disappear. Re-dispatch primary-button mousedown with shiftKey
      // so xterm enters selection mode while leaving wheel scrolling untouched.
      terminalRef.current.addEventListener('mousedown', handleForcedSelectionMouseDown, true);

      // Wheel/trackpad gestures stay inside the terminal surface. xterm still
      // handles the terminal-facing semantics, but the browser/app shell must not
      // see the gesture or reinterpret it as page scroll / chat history.

      // Register input/resize handlers once per terminal instance.
      // Using wsRef.current ensures they always send to the current WebSocket,
      // even after reconnects — this avoids accumulating duplicate handlers
      // that would send each keystroke multiple times.
      term.onData((data: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(data);
        }
      });
    }

    // Connect to WebSocket on same port as the page (frontend and API are served together)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?session=${encodeURIComponent(sessionName)}`;

    const ws = new WebSocket(wsUrl);
    // IMPORTANT: Use arraybuffer for synchronous binary processing
    // Default 'blob' requires async handling which can cause out-of-order writes
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('XTerminal: WebSocket opened');
      readyForLiveData.current = false;
      remoteSize.current = null;

      const measured = getMeasuredSize() ?? { cols: term!.cols, rows: term!.rows };
      requestedSize.current = measured;
      console.log('XTerminal: Sending attach dimensions:', measured.cols, 'x', measured.rows);
      ws.send(JSON.stringify({ type: 'attach', cols: measured.cols, rows: measured.rows }));
    };

    // DEBUG: Enable detailed logging to diagnose terminal corruption
    // Set localStorage.setItem('DEBUG_TERMINAL', '1') to enable
    const DEBUG_TERMINAL = localStorage.getItem('DEBUG_TERMINAL') === '1';
    let debugMsgCount = 0;
    const debugLog: string[] = [];

    // Helper to show escape sequences in readable form
    const escapeForLog = (str: string): string => {
      return str.replace(/[\x00-\x1f\x7f-\xff]/g, (c) => {
        const code = c.charCodeAt(0);
        if (code === 0x1b) return '\\e';
        if (code === 0x0a) return '\\n';
        if (code === 0x0d) return '\\r';
        return `\\x${code.toString(16).padStart(2, '0')}`;
      });
    };

    if (DEBUG_TERMINAL) {
      console.log('XTerminal: Debug logging enabled. Messages will be logged to console and window.terminalDebugLog');
      (window as any).terminalDebugLog = debugLog;
      (window as any).showTerminalDebug = () => {
        debugLog.forEach(entry => console.log(entry));
      };
    }

    // Write queue: serialize writes to avoid race conditions in xterm.js.
    // Smart auto-scroll: only snap to bottom after a write if the user hasn't scrolled up.
    const writeQueue: string[] = [];
    let isWriting = false;

    const processWriteQueue = () => {
      if (isWriting || writeQueue.length === 0 || !term) return;

      isWriting = true;
      const data = writeQueue.shift()!;

      if (DEBUG_TERMINAL) {
        console.log(`XTerminal-debug: WRITE len=${data.length}`);
      }

      // Use write callback to know when this write completes
      term.write(data, () => {
        // With tmux-managed history, keep the viewport pinned to the live bottom.
        // Local xterm scrollback is disabled, so scrolling is delegated to tmux.
        term!.scrollToBottom();

        isWriting = false;
        // Process next item in queue
        if (writeQueue.length > 0) {
          // Use setTimeout(0) to avoid deep recursion
          setTimeout(processWriteQueue, 0);
        }
      });
    };

    const queueLiveData = (data: string) => {
      reconnectAttempts.current = 0;
      writeQueue.push(data);
      processWriteQueue();
    };

    ws.onmessage = (event) => {
      let dataStr = '';

      // Normalize data to string
      if (event.data instanceof ArrayBuffer) {
        dataStr = new TextDecoder().decode(new Uint8Array(event.data));
      } else if (typeof event.data === 'string') {
        dataStr = event.data;
      }

      // DEBUG: Log incoming data
      if (DEBUG_TERMINAL) {
        debugMsgCount++;
        const logEntry = `[${new Date().toISOString()}] RECV #${debugMsgCount} len=${dataStr.length}\n  DATA: ${escapeForLog(dataStr).slice(0, 500)}${dataStr.length > 500 ? '...' : ''}`;
        debugLog.push(logEntry);
        if (debugMsgCount <= 20 || debugMsgCount % 100 === 0) {
          console.log(`XTerminal-debug: RECV #${debugMsgCount} len=${dataStr.length}`);
        }
      }

      if (dataStr.startsWith('\u0000')) {
        let control: TerminalSnapshotMessage | TerminalSizeMessage | null = null;
        try {
          control = JSON.parse(dataStr.slice(1)) as TerminalSnapshotMessage | TerminalSizeMessage;
        } catch {
          control = null;
        }

        if (control?.type === 'snapshot') {
          remoteSize.current = { cols: control.cols, rows: control.rows };
          requestedSize.current = { cols: control.cols, rows: control.rows };
          readyForLiveData.current = false;
          writeQueue.length = 0;
          isWriting = false;

          const resettable = term as Terminal & { reset?: () => void };
          resettable.reset?.();
          term!.resize(control.cols, control.rows);
          // Kick off snapshot write; don't wait for xterm.js callback to send ready.
          // In background tabs xterm.js's setTimeout-based parser stalls, which would
          // let the server's pending buffer grow unbounded and then flood us on resume.
          term!.write(control.data, () => {
            term!.scrollToBottom();
            readyForLiveData.current = true;
          });
          reconnectAttempts.current = 0;
          ws.send(JSON.stringify({ type: 'ready' }));
          sendResizeIfNeeded();
          return;
        }

        if (control?.type === 'size') {
          remoteSize.current = { cols: control.cols, rows: control.rows };
          if (term!.cols !== control.cols || term!.rows !== control.rows) {
            term!.resize(control.cols, control.rows);
          }
          return;
        }
      }

      queueLiveData(dataStr);
    };

    ws.onclose = (event) => {
      console.log('XTerminal: WebSocket closed', event.code, event.reason);

      if (!shouldReconnect) {
        term!.writeln('\r\n\x1b[33m● Session disconnected\x1b[0m');
        onDisconnectRef.current?.();
        return;
      }

      // Always attempt reconnection when shouldReconnect is true, even for
      // code 1000 (normal close). The server sends 1000 when the PTY exits,
      // which can happen if the tmux session is killed and recreated during
      // workspace setup retries. The session may be alive again by the time
      // we reconnect.
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = getReconnectDelay(reconnectAttempts.current);
        reconnectAttempts.current += 1;

        term!.writeln(`\r\n\x1b[33m● Connection lost — reconnecting to \x1b[1m${sessionName}\x1b[0m\x1b[33m in ${delay / 1000}s (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})...\x1b[0m`);

        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        term!.writeln(`\r\n\x1b[31m● Could not reconnect to \x1b[1m${sessionName}\x1b[0m\x1b[31m after ${maxReconnectAttempts} attempts.\x1b[0m`);
        onDisconnectRef.current?.();
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    const handleResize = debounce(() => {
      if (ws.readyState === WebSocket.OPEN) {
        sendResizeIfNeeded();
      }
    }, 200);
    window.addEventListener('resize', handleResize);

    // If the tab was hidden while a snapshot was being written, xterm.js's
    // setTimeout-driven parser stalls and the ready message never goes out.
    // Force it through on visibility restore so the server flushes its buffer
    // promptly instead of dumping hours of backlog at once.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !readyForLiveData.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ready' }));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      terminalRef.current?.removeEventListener('mousedown', handleForcedSelectionMouseDown, true);
      terminalRef.current?.removeEventListener('contextmenu', handleContextMenu);
      setShouldReconnect(false);
      readyForLiveData.current = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      // Prevent the old ws.onclose handler (which closes over the stale
      // shouldReconnect value) from scheduling an orphaned reconnect timer
      // after the component has already remounted.
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
      term?.dispose();
      terminalInstance.current = null;
      fitAddon.current = null;
    };
  }, [sessionName, shouldReconnect, autoCopyOnSelect, handleKeyDown, handleContextMenu, handleTerminalWheel, getMeasuredSize, sendResizeIfNeeded]);

  useEffect(() => {
    let cancelled = false;
    let cleanupFn: (() => void) | undefined;

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        cleanupFn = connect();
      }
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      cleanupFn?.();
    };
  }, [connect]);

  useEffect(() => {
    const debouncedFit = debounce(() => {
      sendResizeIfNeeded();
    }, 200);

    const resizeObserver = new ResizeObserver(debouncedFit);

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [sendResizeIfNeeded]);

  const handleClick = () => {
    terminalInstance.current?.focus();
  };

  return (
    <div className="relative w-full h-full">
      {/* Settings button */}
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1.5 rounded bg-card/80 hover:bg-accent/80 text-muted-foreground transition-colors"
          title="Terminal settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="absolute top-10 right-2 z-20 w-64 p-3 rounded-lg bg-card border border-border shadow-xl">
          <h3 className="text-sm font-semibold text-foreground mb-3">Terminal Settings</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCopyOnSelect}
              onChange={(e) => setAutoCopyOnSelect(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-input text-primary focus:ring-primary"
            />
            <span className="text-sm text-muted-foreground">Auto-copy on selection</span>
          </label>
          <p className="text-xs text-muted-foreground mt-2">
            Automatically copy selected text to clipboard
          </p>
        </div>
      )}

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="absolute inset-0"
        onClick={handleClick}
        tabIndex={0}
        style={{
          padding: '8px',
          backgroundColor: '#1a1a2e',
          overflow: 'hidden',
          outline: 'none',
        }}
      />

      {/* Context menu */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 min-w-[120px] py-1 rounded-lg bg-card border border-border shadow-xl"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.canCopy && (
            <button
              onClick={handleContextCopy}
              className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-card transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
              <span className="ml-auto text-xs text-muted-foreground">
                {isMac ? '⌘C' : 'Ctrl+C'}
              </span>
            </button>
          )}
          <button
            onClick={handleContextPaste}
            className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-card transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Paste
            <span className="ml-auto text-xs text-muted-foreground">
              {isMac ? '⌘V' : 'Ctrl+V'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
