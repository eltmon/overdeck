import { useState, useCallback } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { XTerminal } from './XTerminal';

export type SessionState = 'connecting' | 'ended';

interface TerminalSessionWrapperProps {
  sessionName: string;
  /** Fired when XTerminal exhausts its reconnect attempts */
  onSessionEnded?: () => void;
}

const bgCard = '#0d1117';
const bgInner = '#161b26';
const borderColor = '#232f48';
const textSecondary = '#92a4c9';
const textMuted = '#4a5568';
const accentOrange = '#fb923c';

export function TerminalSessionWrapper({ sessionName, onSessionEnded }: TerminalSessionWrapperProps) {
  const [state, setState] = useState<SessionState>('connecting');

  const handleDisconnect = useCallback(() => {
    setState('ended');
    onSessionEnded?.();
  }, [onSessionEnded]);

  if (state === 'ended') {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-4 p-6"
        style={{ backgroundColor: bgCard }}
      >
        <div
          className="flex items-center justify-center w-10 h-10 rounded-full"
          style={{ backgroundColor: '#2d1a00', border: `1.5px solid ${accentOrange}` }}
        >
          <WifiOff className="w-5 h-5" style={{ color: accentOrange }} />
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-sm font-medium" style={{ color: textSecondary }}>
            Session ended
          </span>
          <span className="text-xs max-w-[200px]" style={{ color: textMuted }}>
            The tmux session{' '}
            <code className="font-mono" style={{ color: textSecondary }}>
              {sessionName}
            </code>{' '}
            is no longer available.
          </span>
        </div>
        <button
          onClick={() => setState('connecting')}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors"
          style={{
            color: textSecondary,
            backgroundColor: bgInner,
            border: `1px solid ${borderColor}`,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#3a4a6a';
            (e.currentTarget as HTMLButtonElement).style.color = '#e2e8f0';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = borderColor;
            (e.currentTarget as HTMLButtonElement).style.color = textSecondary;
          }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry connection
        </button>
      </div>
    );
  }

  // 'connecting': render XTerminal normally
  return (
    <XTerminal
      key={`${sessionName}-${state}`}
      sessionName={sessionName}
      onDisconnect={handleDisconnect}
    />
  );
}
