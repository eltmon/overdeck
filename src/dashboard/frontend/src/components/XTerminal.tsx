import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Debounce utility to prevent resize spam
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

interface XTerminalProps {
  sessionName: string;
  onDisconnect?: () => void;
}

export function XTerminal({ sessionName, onDisconnect }: XTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxReconnectAttempts = 5;
  const [shouldReconnect, setShouldReconnect] = useState(true);

  // Store onDisconnect in a ref to avoid reconnection loops
  const onDisconnectRef = useRef(onDisconnect);
  onDisconnectRef.current = onDisconnect;

  // Calculate exponential backoff delay: 1s, 2s, 4s, 8s, max 30s
  const getReconnectDelay = (attempt: number): number => {
    return Math.min(1000 * Math.pow(2, attempt), 30000);
  };

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

    if (!term) {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        cols: 120,
        rows: 30,
        scrollback: 10000,          // Increase scrollback buffer
        convertEol: true,           // Convert \n to \r\n for proper display
        scrollOnUserInput: true,    // Auto-scroll to bottom when user types
        allowProposedApi: true,     // Enable proposed APIs for better compatibility
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
    }

    // Connect to WebSocket on backend port (3011)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const backendPort = '3011';
    const wsUrl = `${protocol}//${window.location.hostname}:${backendPort}/ws/terminal?session=${encodeURIComponent(sessionName)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('XTerminal: WebSocket opened');
      // Reset reconnect attempts on successful connection
      reconnectAttempts.current = 0;

      // Clear terminal buffer on connect to ensure fresh content from server
      // The server sends the current pane content immediately on connect
      term.clear();

      // Small delay to ensure container is fully laid out, then fit once
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        fit?.fit();
        console.log('XTerminal: After fit, size:', term.cols, 'x', term.rows);
        // Send initial resize - server will handle the rest
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }, 100);
    };

    ws.onmessage = (event) => {
      // Write data to terminal and scroll to bottom
      const writeAndScroll = (data: string | Uint8Array) => {
        term.write(data);
        // Always scroll to bottom when new data arrives
        term.scrollToBottom();
      };

      if (typeof event.data === 'string') {
        writeAndScroll(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        writeAndScroll(new Uint8Array(event.data));
      } else if (event.data instanceof Blob) {
        event.data.text().then(text => writeAndScroll(text));
      }
    };

    ws.onclose = (event) => {
      console.log('XTerminal: WebSocket closed', event.code, event.reason);

      // Don't attempt to reconnect if this was a clean shutdown or if we shouldn't reconnect
      if (!shouldReconnect || event.code === 1000) {
        term.writeln('\r\n\x1b[33m● Session disconnected\x1b[0m');
        onDisconnectRef.current?.();
        return;
      }

      // Attempt to reconnect with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = getReconnectDelay(reconnectAttempts.current);
        reconnectAttempts.current += 1;

        term.writeln(`\r\n\x1b[33m● Connection lost. Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})...\x1b[0m`);

        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        // Max attempts reached
        term.writeln('\r\n\x1b[31m● Connection lost after multiple attempts.\x1b[0m');
        onDisconnectRef.current?.();
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      // onclose will be called after onerror, so we handle reconnection there
    };

    // Forward terminal input to WebSocket
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Handle window resize (debounced to prevent spam)
    const handleResize = debounce(() => {
      if (ws.readyState === WebSocket.OPEN) {
        fit?.fit();
      }
    }, 200);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      setShouldReconnect(false);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      ws.close();
      term.dispose();
      terminalInstance.current = null;
      fitAddon.current = null;
    };
  }, [sessionName, shouldReconnect]);

  useEffect(() => {
    // Track if this effect instance has been cancelled (handles React StrictMode double-invoke)
    let cancelled = false;
    let cleanupFn: (() => void) | undefined;

    // Small delay to avoid StrictMode rapid mount/unmount issues
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

  // Re-fit terminal when container size changes
  useEffect(() => {
    // Debounce fit to prevent resize spam (200ms is imperceptible but prevents blocking)
    const debouncedFit = debounce(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
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

  // Click handler to focus terminal
  const handleClick = () => {
    terminalInstance.current?.focus();
  };

  return (
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
  );
}
