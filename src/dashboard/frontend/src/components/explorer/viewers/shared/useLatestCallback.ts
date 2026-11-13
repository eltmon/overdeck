/**
 * React 18 stand-in for React 19's useEffectEvent (PAN-5188 §6.10): a stable
 * function identity that always calls the newest closure.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

export function useLatestCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
