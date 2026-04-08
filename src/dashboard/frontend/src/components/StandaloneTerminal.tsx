import { useState, useEffect } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { XTerminal } from './XTerminal';

interface StandaloneTerminalProps {
  sessionName: string;
}

export function StandaloneTerminal({ sessionName }: StandaloneTerminalProps) {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => {
    // Set initial title from window name (populated by popoutTerminal)
    setTitle(document.title);
  }, []);

  const handleAlwaysOnTop = () => {
    const bridge = window.panopticonBridge;
    if (bridge?.isDesktopApp()) {
      const newValue = !isAlwaysOnTop;
      setIsAlwaysOnTop(newValue);
      bridge.setAlwaysOnTop(newValue);
    } else {
      // Browser popup: just focus the window
      window.focus();
    }
  };

  const borderColor = '#232f48';
  const textSecondary = '#92a4c9';

  return (
    <div
      className="flex flex-col h-full min-w-0"
      style={{ backgroundColor: '#0d1117' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b shrink-0"
        style={{ borderColor, backgroundColor: '#161b26' }}
      >
        <span className="text-xs font-medium" style={{ color: textSecondary }}>
          {title || sessionName}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleAlwaysOnTop}
            className="p-1 rounded transition-colors hover:bg-white/10"
            style={{ color: isAlwaysOnTop ? '#58a6ff' : textSecondary }}
            title={isAlwaysOnTop ? 'Disable always on top' : 'Enable always on top'}
          >
            {isAlwaysOnTop ? (
              <PinOff className="w-3.5 h-3.5" />
            ) : (
              <Pin className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0">
        <XTerminal sessionName={sessionName} />
      </div>
    </div>
  );
}
