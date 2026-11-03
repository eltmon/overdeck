/**
 * The viewer's read-only view of the host terminal in a Shared Session (PAN-4477 WI-8, FR-1, FR-3).
 *
 * `watch` registers a listener for the host's `TerminalPayload`s and returns its stop function;
 * mounting starts the watch and unmounting stops it. The xterm is created with `disableStdin` and
 * no input handler, so nothing typed here reaches the host. It sizes to the host's grid, never to
 * its container (D-10): no fit addon, and the container scrolls when the host grid is larger.
 */
import type { TerminalPayload, TerminalUnavailableReason } from '@overdeck/contracts';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';

import { useColorTheme } from '../../../hooks/useColorTheme';
import { useTheme } from '../../../hooks/useTheme';

export type TerminalWatch = (listener: (payload: TerminalPayload) => void) => () => void;

const NOTICES: Record<TerminalUnavailableReason, string> = {
  terminal_not_found: "The host's terminal is not running.",
  terminal_ended: "The host's terminal session ended.",
};

// Same resolution as XTerminal's resolveMonoFontFamily: xterm needs a concrete font-family string.
function resolveMonoFontFamily(): string {
  const fallback = "'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
  const resolved = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return resolved || fallback;
}

export function SharedTerminalView({ watch }: { watch: TerminalWatch }) {
  const isDark = useTheme((s) => s.resolvedTheme) !== 'light';
  const palette = useColorTheme((s) => s.terminalPalette(isDark ? 'dark' : 'light'));
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [notice, setNotice] = useState<TerminalUnavailableReason | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      scrollback: 0,
      convertEol: false,
      fontSize: 14,
      fontFamily: resolveMonoFontFamily(),
      theme: { ...paletteRef.current },
    });
    term.open(host);
    termRef.current = term;
    const stop = watch((payload) => {
      switch (payload.kind) {
        case 'snapshot':
          term.reset();
          term.resize(payload.cols, payload.rows);
          term.write(payload.data);
          setNotice(null);
          break;
        case 'output':
          term.write(payload.data);
          break;
        case 'size':
          term.resize(payload.cols, payload.rows);
          break;
        case 'unavailable':
          setNotice(payload.reason);
          break;
      }
    });
    return () => {
      stop();
      termRef.current = null;
      term.dispose();
    };
  }, [watch]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = { ...palette };
  }, [palette]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
        Read-only — you are watching the host's terminal.
      </p>
      {notice ? (
        <p role="status" className="px-4 py-2 text-sm text-muted-foreground">{NOTICES[notice]}</p>
      ) : null}
      <div data-testid="shared-terminal" className="min-h-0 flex-1 overflow-auto bg-background p-2">
        <div ref={hostRef} className="inline-block" />
      </div>
    </div>
  );
}
