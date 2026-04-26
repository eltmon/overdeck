import { useEffect, useRef, useState } from 'react';

/**
 * <LiveCounter value unit precision pulseOnIncrement /> — animated number readout.
 *
 * - Animates the number on change (vertical scroll fade, 250ms).
 * - Pulses the unit symbol on increment when pulseOnIncrement=true (300ms scale).
 * - Big-jump highlight: when delta > bigJumpDelta, briefly flashes background for 600ms.
 */

interface LiveCounterProps {
  value: number;
  unit?: string;
  precision?: number;
  pulseOnIncrement?: boolean;
  bigJumpDelta?: number;
  className?: string;
}

function format(value: number, precision: number): string {
  return value.toFixed(precision);
}

export function LiveCounter({
  value,
  unit,
  precision = 0,
  pulseOnIncrement = false,
  bigJumpDelta,
  className,
}: LiveCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [scrolling, setScrolling] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const [bigJump, setBigJump] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === value) return;

    const delta = value - prev;
    setScrolling(true);
    if (pulseOnIncrement && delta > 0) setPulsing(true);
    if (bigJumpDelta != null && Math.abs(delta) >= bigJumpDelta) setBigJump(true);

    const t1 = setTimeout(() => {
      setDisplayValue(value);
      setScrolling(false);
    }, 250);
    const t2 = setTimeout(() => setPulsing(false), 300);
    const t3 = setTimeout(() => setBigJump(false), 600);

    prevRef.current = value;
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [value, pulseOnIncrement, bigJumpDelta]);

  return (
    <span
      data-testid="live-counter"
      data-scrolling={scrolling || undefined}
      data-pulsing={pulsing || undefined}
      data-big-jump={bigJump || undefined}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 1,
        transition: 'background 600ms ease-out',
        background: bigJump
          ? 'color-mix(in srgb, var(--primary) 8%, transparent)'
          : 'transparent',
        borderRadius: 4,
        padding: '0 2px',
      }}
    >
      {unit && (
        <span
          data-testid="live-counter-unit"
          style={{
            display: 'inline-block',
            transform: pulsing ? 'scale(1.15)' : 'scale(1)',
            transition: 'transform 300ms ease-out',
            opacity: 0.85,
          }}
        >
          {unit}
        </span>
      )}
      <span
        data-testid="live-counter-value"
        style={{
          display: 'inline-block',
          transform: scrolling ? 'translateY(-2px)' : 'translateY(0)',
          opacity: scrolling ? 0.6 : 1,
          transition: 'transform 250ms ease-out, opacity 250ms ease-out',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {format(displayValue, precision)}
      </span>
    </span>
  );
}
