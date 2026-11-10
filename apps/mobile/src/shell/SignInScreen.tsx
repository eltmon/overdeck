import { useState } from 'react';

import type { SignedOutNotice } from './accountDeletion';
import { DELETION_STARTED_MESSAGE, FINISH_ON_WEB_MESSAGE } from './accountDeletionCopy';

interface SignInScreenProps {
  onSignIn(): Promise<void>;
  error: string | null;
  /** Shown after the phone signs out from an account deletion (PAN-5107). */
  notice?: SignedOutNotice | null;
  /** Opens the account page on overdeck.ai in the system browser (PAN-5107). */
  onOpenAccountPage?: () => void;
}

export function SignInScreen({ onSignIn, error, notice, onOpenAccountPage }: SignInScreenProps) {
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
      {notice ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-foreground">
            {notice === 'deletion-requested' ? DELETION_STARTED_MESSAGE : FINISH_ON_WEB_MESSAGE}
          </p>
          {notice === 'finish-on-web' ? (
            <button
              type="button"
              onClick={() => onOpenAccountPage?.()}
              className="min-h-11 w-full rounded-sm border border-border px-3 text-sm font-medium text-foreground"
            >
              Delete on the web
            </button>
          ) : null}
        </div>
      ) : null}
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
