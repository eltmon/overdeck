import { useEffect, useState } from 'react';

import { isNativeShell } from './nativeShell';

/**
 * PAN-4834 CP-2: an `<img>` loads its own URL and bypasses the channel shims, so in the
 * phone app a machine `/api/…` image is fetched (through the shimmed `fetch`) into an object URL.
 * Elsewhere the URL is returned unchanged. On failure the original URL is returned so the
 * element's own `onError` handling runs.
 */
export function useChannelMediaSrc(url: string | null | undefined): string | undefined {
  const routed = !!url && isNativeShell() && url.startsWith('/api/');
  // Keyed by the URL it was loaded for, so a stale result never shows for a new URL.
  const [loaded, setLoaded] = useState<{ url: string; src: string } | null>(null);

  useEffect(() => {
    if (!routed || !url) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ url, src: objectUrl });
      } catch {
        if (!cancelled) setLoaded({ url, src: url });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [routed, url]);

  if (!url) return undefined;
  if (!routed) return url;
  return loaded?.url === url ? loaded.src : undefined;
}
