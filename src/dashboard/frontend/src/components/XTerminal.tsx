import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getTransport } from '../lib/wsTransport';
import { WS_METHODS } from '@panopticon/contracts';

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
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const connectedRef = useRef(false);

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

  // Send data to terminal via RPC (fire-and-forget)
  const sendTerminalData = useCallback((data: string) => {
    if (!connectedRef.current) return;
    getTransport().request(
      (client) => client[WS_METHODS.terminalWrite]({ sessionName, data }),
    ).catch(() => {
      // Silently ignore write failures — transport handles reconnection
    });
  }, [sessionName]);

  // Send resize to terminal via RPC (fire-and-forget)
  const sendTerminalResize = useCallback((cols: number, rows: number) => {
    if (!connectedRef.current) return;
    getTransport().request(
      (client) => client[WS_METHODS.terminalResize]({ sessionName, cols, rows }),
    ).catch(() => {
      // Silently ignore resize failures
    });
  }, [sessionName]);

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
      sendTerminalData(text);
    } catch (err) {
      console.error('Failed to read from clipboard:', err);
    }
  }, [sendTerminalData]);

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
    const term = terminalInstance.current;
    if (!term) return;

    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      canCopy: term.hasSelection(),
    });
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

    if (!term) {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        cols: 120,
        rows: 29,  // Match typical fitted size to avoid row mismatch with tmux status bar
        scrollback: 5000,  // Local scroll buffer; the real status-bar fix is dimension-sync (Attempt 14)
        convertEol: false,  // Don't convert EOL - let escape sequences pass through raw
        scrollOnUserInput: true,
        allowProposedApi: true,
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
      fit.fit();

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

      // Intercept wheel events: scroll xterm.js locally instead of forwarding to tmux.
      // Without this, xterm.js sends mouse escape sequences to tmux, which passes them
      // to Claude Code's TUI input area instead of entering copy-mode.
      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const scrollLines = Math.round(event.deltaY / 20);
        term!.scrollLines(scrollLines);
      };
      terminalRef.current.addEventListener('wheel', handleWheel, { passive: false });
    }

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
        // Smart auto-scroll: only snap to bottom if user hasn't scrolled up
        const buf = term!.buffer.active;
        const isAtBottom = buf.viewportY >= buf.length - term!.rows;
        if (isAtBottom) {
          term!.scrollToBottom();
        }

        isWriting = false;
        // Process next item in queue
        if (writeQueue.length > 0) {
          // Use setTimeout(0) to avoid deep recursion
          setTimeout(processWriteQueue, 0);
        }
      });
    };

    // Fit terminal to get accurate dimensions before subscribing
    fit?.fit();
    const initialCols = term.cols;
    const initialRows = term.rows;
    console.log('XTerminal: Starting RPC subscription with dimensions:', initialCols, 'x', initialRows);

    // Subscribe to terminal output stream via Effect RPC
    // Use longer retry delay (2s) to give planning agents time to create tmux sessions
    connectedRef.current = true;
    term.clear();
    term.writeln('\x1b[33m● Connecting to session...\x1b[0m');
    let hasReceivedData = false;

    const unsubscribe = getTransport().subscribe(
      (client) => {
        // Show reconnecting message on retry (not first connect)
        if (hasReceivedData) {
          term.writeln('\r\n\x1b[33m● Connection lost. Reconnecting...\x1b[0m');
        } else if (!hasReceivedData) {
          // Still waiting for first data — update status
          term.write('\r\x1b[2K\x1b[33m● Waiting for session to start...\x1b[0m');
        }
        return client[WS_METHODS.subscribeTerminal]({
          sessionName,
          cols: initialCols,
          rows: initialRows,
        });
      },
      (output) => {
        const dataStr = output.data;

        // On first real data, clear the "Connecting/Waiting" message.
        // Use reset() instead of clear() — reset reinitializes the terminal
        // which properly handles alternate screen buffer TUIs (Claude Code).
        if (!hasReceivedData) {
          hasReceivedData = true;
          term.reset();
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

        // Add to queue and trigger processing
        writeQueue.push(dataStr);
        processWriteQueue();
      },
      { retryDelay: 2000 },
    );

    unsubscribeRef.current = unsubscribe;

    // Wire keyboard input to terminal write RPC
    const onDataDisposable = term.onData((data: string) => {
      sendTerminalData(data);
    });

    // Wire resize events to terminal resize RPC
    const onResizeDisposable = term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      sendTerminalResize(cols, rows);
    });

    const handleResize = debounce(() => {
      if (connectedRef.current) {
        fit?.fit();
      }
    }, 200);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      connectedRef.current = false;
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      unsubscribe();
      unsubscribeRef.current = null;
      // Close the terminal session on the server
      getTransport().request(
        (client) => client[WS_METHODS.terminalClose]({ sessionName }),
      ).catch(() => { /* ignore cleanup errors */ });
      term?.dispose();
      terminalInstance.current = null;
      fitAddon.current = null;
    };
  }, [sessionName, autoCopyOnSelect, handleKeyDown, handleContextMenu, sendTerminalData, sendTerminalResize]);

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
      if (connectedRef.current) {
        fitAddon.current?.fit();
      }
    }, 200);

    const resizeObserver = new ResizeObserver(debouncedFit);

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleClick = () => {
    terminalInstance.current?.focus();
  };

  return (
    <div className="relative w-full h-full">
      {/* Settings button */}
      <div className="absolute top-2 right-2 z-10 flex gap-2">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1.5 rounded bg-slate-700/80 hover:bg-slate-600/80 text-slate-300 transition-colors"
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
        <div className="absolute top-10 right-2 z-20 w-64 p-3 rounded-lg bg-slate-800 border border-slate-700 shadow-xl">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Terminal Settings</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCopyOnSelect}
              onChange={(e) => setAutoCopyOnSelect(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-300">Auto-copy on selection</span>
          </label>
          <p className="text-xs text-slate-500 mt-2">
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
          className="fixed z-50 min-w-[120px] py-1 rounded-lg bg-slate-800 border border-slate-700 shadow-xl"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.canCopy && (
            <button
              onClick={handleContextCopy}
              className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
              <span className="ml-auto text-xs text-slate-500">
                {isMac ? '⌘C' : 'Ctrl+C'}
              </span>
            </button>
          )}
          <button
            onClick={handleContextPaste}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Paste
            <span className="ml-auto text-xs text-slate-500">
              {isMac ? '⌘V' : 'Ctrl+V'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
