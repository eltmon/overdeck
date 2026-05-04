import { useState, useEffect, useCallback, useRef } from 'react';
import { EyeOff } from 'lucide-react';

interface SensitiveTextProps {
  value: string;
  className?: string;
  revealDuration?: number;
}

export function SensitiveText({ value, className = '', revealDuration = 5000 }: SensitiveTextProps) {
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const hide = useCallback(() => setRevealed(false), []);

  useEffect(() => {
    if (!revealed) return;
    timerRef.current = setTimeout(hide, revealDuration);
    window.addEventListener('blur', hide);
    return () => {
      clearTimeout(timerRef.current);
      window.removeEventListener('blur', hide);
    };
  }, [revealed, hide, revealDuration]);

  if (revealed) {
    return (
      <span
        className={`cursor-pointer ${className}`}
        onClick={hide}
        title="Click to hide"
      >
        {value}
      </span>
    );
  }

  return (
    <span
      className={`cursor-pointer inline-flex items-center gap-1 ${className}`}
      onClick={() => setRevealed(true)}
      title="Click to reveal"
    >
      <EyeOff className="w-3 h-3 opacity-50 shrink-0" />
      <span className="tracking-wider">{'••••••••'}</span>
    </span>
  );
}
