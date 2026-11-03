/**
 * MobilePairScreen — pairing inside the installed phone app (PAN-2355 FR-6, D-8).
 *
 * An installed iPhone app cannot reuse a Safari pairing cookie, and nobody
 * types a 64-character code on a phone, so the shell shows this screen when
 * the session mint fails. It scans the QR code with the rear camera (`jsqr`,
 * loaded only here) or takes a pasted link, then hands the credential to the
 * existing bootstrap: `/m#pair=<code>` plus a reload, which
 * `ensureDashboardSession` consumes and exchanges exactly as on the desktop.
 */
import { useCallback, useState } from 'react';

import { useQrScanner } from './useQrScanner';

const PAIRING_CODE = /(odp_[0-9a-f]{64})/;

export function parsePairingInput(input: string, origin: string): { credential: string } | { error: string } {
  const text = input.trim();
  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (url && (url.protocol === 'https:' || url.protocol === 'http:') && url.origin !== origin) {
    return { error: `This code is for ${url.origin}. Open Overdeck at that address instead.` };
  }
  const match = PAIRING_CODE.exec(text);
  if (!match) return { error: 'That is not an Overdeck pairing code.' };
  return { credential: match[1]! };
}

function handOffCredential(credential: string): void {
  window.history.replaceState(null, '', `/m#pair=${credential}`);
  window.location.reload();
}

export function MobilePairScreen() {
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback((text: string): boolean => {
    const parsed = parsePairingInput(text, window.location.origin);
    if ('error' in parsed) {
      setError(parsed.error);
      return false;
    }
    handOffCredential(parsed.credential);
    return true;
  }, []);

  const scanner = useQrScanner(accept);

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+1rem)]">
      <h2 className="text-base font-medium text-foreground">Pair this phone</h2>
      <p className="text-sm text-muted-foreground">
        On your computer, open Settings → Anywhere → Set up a phone, then scan the pairing code shown there.
      </p>
      <video
        ref={scanner.videoRef}
        playsInline
        muted
        aria-label="Camera preview"
        className={scanner.scanning ? 'w-full rounded-sm bg-black' : 'hidden'}
      />
      <canvas ref={scanner.canvasRef} className="hidden" />
      {scanner.scanning ? (
        <button
          type="button"
          onClick={scanner.stop}
          className="min-h-11 w-full rounded-sm border border-border px-3 text-sm font-medium text-foreground"
        >
          Stop scanning
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void scanner.start()}
          className="min-h-11 w-full rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          Scan pairing code
        </button>
      )}
      {scanner.cameraError ? <p className="text-sm text-muted-foreground">{scanner.cameraError}</p> : null}
      <label className="flex flex-col gap-1 text-sm text-foreground">
        Pairing link
        <input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Paste the pairing link"
          className="min-h-11 rounded-sm border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </label>
      <button
        type="button"
        disabled={pasted.trim().length === 0}
        onClick={() => accept(pasted)}
        className="min-h-11 w-full rounded-sm border border-border px-3 text-sm font-medium text-foreground disabled:opacity-50"
      >
        Pair
      </button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
