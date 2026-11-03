import { connectionText } from './connection';

interface RemovedScreenProps {
  label: string;
  onPairAgain(): void;
  onForget(): void;
}

/** The current machine refused this phone's link key: it was removed there (PAN-4837 FR-10). */
export function RemovedScreen({ label, onPairAgain, onForget }: RemovedScreenProps) {
  return (
    <section data-component="removed-screen" className="flex flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+2rem)]">
      <p role="alert" className="text-sm text-foreground">{connectionText.removed(label)}</p>
      <button type="button" onClick={onPairAgain} className="min-h-11 w-full rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground">
        Pair again
      </button>
      <button type="button" onClick={onForget} className="min-h-11 w-full rounded-sm border border-border px-3 text-sm font-medium text-foreground">
        Forget
      </button>
    </section>
  );
}
