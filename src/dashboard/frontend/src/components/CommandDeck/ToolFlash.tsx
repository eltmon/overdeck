import { useEffect, useRef, useState } from 'react';

/**
 * <ToolFlash currentTool /> — cross-fades the active tool name on change.
 *
 * On change, the previous tool fades out (200ms) while the new tool fades in (200ms),
 * separated by an arrow. After the transition, only the new tool is visible.
 */

interface ToolFlashProps {
  currentTool: string | null | undefined;
  className?: string;
}

const FADE_MS = 200;

export function ToolFlash({ currentTool, className }: ToolFlashProps) {
  const display = currentTool ?? 'idle';
  const [shown, setShown] = useState(display);
  const [prev, setPrev] = useState<string | null>(null);
  const [phase, setPhase] = useState<'stable' | 'transitioning'>('stable');
  const lastSeen = useRef(display);

  useEffect(() => {
    if (display === lastSeen.current) return;

    setPrev(lastSeen.current);
    setShown(display);
    setPhase('transitioning');
    lastSeen.current = display;

    const t = setTimeout(() => {
      setPrev(null);
      setPhase('stable');
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [display]);

  return (
    <span
      data-testid="tool-flash"
      data-phase={phase}
      data-current={shown}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 12,
        color: 'var(--muted-foreground)',
        minWidth: 0,
      }}
    >
      {prev != null && (
        <>
          <span
            data-testid="tool-flash-prev"
            style={{
              opacity: phase === 'transitioning' ? 0 : 1,
              transition: `opacity ${FADE_MS}ms ease-out`,
            }}
          >
            {prev}
          </span>
          <span aria-hidden style={{ opacity: 0.5 }}>→</span>
        </>
      )}
      <span
        data-testid="tool-flash-current"
        style={{
          opacity: phase === 'transitioning' ? 0 : 1,
          transition: `opacity ${FADE_MS}ms ease-in`,
          color: 'var(--foreground)',
          fontWeight: 500,
        }}
      >
        {shown}
      </span>
    </span>
  );
}
