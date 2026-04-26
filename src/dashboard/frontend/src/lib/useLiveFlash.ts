import { useState, useEffect, useRef } from 'react';

/**
 * useLiveFlash — triggers a CSS animation class when `watchValue` changes.
 *
 * Used by Command Deck tree rows and panels to flash when live data arrives
 * via domain events (blocker-8: motion catalog within 200ms).
 *
 * @param watchValue  Any serialisable value to watch for changes.
 * @param className   CSS class to apply briefly (default: 'anim-row-flash').
 * @param durationMs  How long to keep the class applied (default: 600).
 */
export function useLiveFlash(
  watchValue: unknown,
  className = 'anim-row-flash',
  durationMs = 600,
): string {
  const [flashClass, setFlashClass] = useState('');
  const prevRef = useRef(watchValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = watchValue;
    if (prev === watchValue) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setFlashClass(className);
    timerRef.current = setTimeout(() => {
      setFlashClass('');
    }, durationMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [watchValue, className, durationMs]);

  return flashClass;
}
