import { useEffect, useState } from 'react';

/** A local clock tick (PAN-5131 NFR-1): re-renders the caller every intervalMs. It fetches nothing. */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
