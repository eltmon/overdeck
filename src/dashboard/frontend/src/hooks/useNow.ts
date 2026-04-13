import { useState, useEffect } from 'react';

/**
 * Returns the current Date, updated on a shared interval.
 * All components using this hook with the same interval will tick together.
 *
 * @param intervalMs - How often to update (default: 60 000ms = 1 minute)
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
