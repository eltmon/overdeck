import { useEffect, useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { XTerminal } from './XTerminal';

interface StandaloneTerminalProps {
  sessionName: string;
  token?: string;
}

export function StandaloneTerminal({ sessionName, token }: StandaloneTerminalProps) {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [title, setTitle] = useState(sessionName);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTitle = params.get('title');
    if (urlTitle) {
      setTitle(decodeURIComponent(urlTitle));
      return;
    }
    if (document.title.trim()) {
      setTitle(document.title);
    }
  }, [sessionName]);

  function handleAlwaysOnTop(): void {
    const bridge = window.panopticonBridge;
    if (bridge?.isDesktopApp?.()) {
      const nextValue = !isAlwaysOnTop;
      setIsAlwaysOnTop(nextValue);
      bridge.setAlwaysOnTop(nextValue);
      return;
    }

    window.focus();
  }

  const borderColor = '#232f48';
  const textSecondary = '#92a4c9';

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#0d1117]">
      <div
        className="flex items-center justify-between border-b px-3 py-1.5 shrink-0"
        style={{ borderColor, backgroundColor: '#161b26' }}
      >
        <span className="text-xs font-medium" style={{ color: textSecondary }}>
          {title}
        </span>
        <button
          onClick={handleAlwaysOnTop}
          className="rounded p-1 transition-colors hover:bg-white/10"
          style={{ color: isAlwaysOnTop ? '#58a6ff' : textSecondary }}
          title={isAlwaysOnTop ? 'Disable always on top' : 'Enable always on top'}
        >
          {isAlwaysOnTop ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <XTerminal sessionName={sessionName} token={token} />
      </div>
    </div>
  );
}
