/** Pair this phone with a machine: scan its QR, paste its link, or open an ai.overdeck.app:/pair link (PAN-4837 FR-6). */
import { parsePhonePairLink } from '@overdeck/contracts';
import { useCallback, useState } from 'react';

import { useQrScanner } from '../../../../src/dashboard/frontend/src/components/mobile/useQrScanner';
import { pairingText } from './pairing';
import type { PairedMachine } from './types';

interface PairScreenProps {
  /** A pair link that opened the app, shown in the paste field. */
  initialLink: string | null;
  /** The directory label of the link's machine, for the progress line. */
  labelFor(link: string): string;
  pair(link: string): Promise<PairedMachine>;
  onPaired(machine: PairedMachine): void;
  onCancel(): void;
}

export function PairScreen({ initialLink, labelFor, pair, onPaired, onCancel }: PairScreenProps) {
  const [pasted, setPasted] = useState(initialLink ?? '');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (text: string) => {
      if (!parsePhonePairLink(text)) {
        setError(pairingText.notALink());
        return;
      }
      setError(null);
      setProgress(`Pairing with ${labelFor(text)}…`);
      try {
        onPaired(await pair(text));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setProgress(null);
      }
    },
    [labelFor, onPaired, pair],
  );

  const onCode = useCallback(
    (text: string): boolean => {
      if (!parsePhonePairLink(text)) return false;
      setPasted(text);
      void run(text);
      return true;
    },
    [run],
  );
  const scanner = useQrScanner(onCode);
  const busy = progress !== null;

  return (
    <section
      data-component="pair-screen"
      className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+1rem)]"
    >
      <h2 className="text-base font-medium text-foreground">Pair a machine</h2>
      <p className="text-sm text-muted-foreground">
        Scan the QR code in Settings → Anywhere → Set up a phone → Overdeck app on your computer.
      </p>
      <video ref={scanner.videoRef} playsInline muted className={scanner.scanning ? 'w-full rounded-sm bg-black' : 'hidden'} />
      <canvas ref={scanner.canvasRef} className="hidden" />
      {scanner.scanning ? (
        <button type="button" onClick={scanner.stop} className="min-h-11 w-full rounded-sm border border-border px-3 text-sm font-medium text-foreground">
          Stop camera
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void scanner.start()}
          disabled={busy}
          className="min-h-11 w-full rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Scan QR code
        </button>
      )}
      {scanner.cameraError ? <p className="text-sm text-muted-foreground">{scanner.cameraError}</p> : null}
      <label className="flex flex-col gap-1 text-sm text-foreground">
        Or paste the pairing link
        <input
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ai.overdeck.app:/pair#…"
          className="min-h-11 rounded-sm border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </label>
      <button
        type="button"
        onClick={() => void run(pasted)}
        disabled={busy || pasted.trim() === ''}
        className="min-h-11 w-full rounded-sm border border-border px-3 text-sm font-medium text-foreground disabled:opacity-50"
      >
        Pair
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 w-full px-3 text-sm text-muted-foreground disabled:opacity-50">
        Cancel
      </button>
      {progress ? <p className="text-sm text-muted-foreground">{progress}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
