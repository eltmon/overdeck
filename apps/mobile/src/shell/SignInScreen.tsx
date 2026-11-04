import { useState } from 'react';

interface SignInScreenProps {
  onSignIn(): Promise<void>;
  error: string | null;
}

export function SignInScreen({ onSignIn, error }: SignInScreenProps) {
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setStartError(null);
    try {
      await onSignIn();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = startError ?? error;
  return (
    <section
      data-component="sign-in-screen"
      className="flex flex-1 flex-col gap-4 px-4 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+2rem)]"
    >
      <h1 className="text-xl font-medium text-foreground">Overdeck</h1>
      <p className="text-sm text-muted-foreground">Sign in with GitHub through overdeck.ai to reach your machines.</p>
      <button
        type="button"
        onClick={() => void signIn()}
        disabled={busy}
        className="min-h-11 w-full rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Sign in
      </button>
      {shown ? <p role="alert" className="text-sm text-destructive">{shown}</p> : null}
    </section>
  );
}
