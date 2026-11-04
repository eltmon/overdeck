/**
 * The Account card in Settings → Anywhere (PAN-4960 FR-1..FR-4): which GitHub account this machine
 * is signed in to overdeck.ai as, its plan, this month's relay use, and a link to the account
 * page. Data comes from `GET /api/account` (account.json, a cached `/v1/me` and the directory).
 *
 * Sign in shows only to a root session in a browser on this machine (`canSignIn`); other viewers
 * get the `pan account login` hint. Sign in is two steps: the POST answers the overdeck.ai URL,
 * then the card shows a link to open it, because `window.open` after an `await` is popup-blocked.
 * While the sign-in is pending the card polls every 2 s; the callback tab cannot message this one.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ACCOUNT_QUERY_KEY, loadAccount, planLabel, relayResetDate, startAccountSignIn, type AccountView } from './accountApi';
import { ANYWHERE_STATUS_QUERY_KEY, apiError, isOk } from './anywhereApi';
import { relayTrafficText } from './AnywhereStatusCard';
import { DIRECTORY_QUERY_KEY } from './directoryApi';

const PRIMARY_BUTTON =
  'rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-xs text-foreground text-right min-w-0">{children}</dd>
    </div>
  );
}

function relayText(account: AccountView): string {
  if (account.plan === 'free') return 'Not included in the free account';
  if (account.relay) {
    return `${relayTrafficText(account.relay.bytesUsed, account.relay.capBytes)} · Resets on ${relayResetDate(account.relay.month)} (UTC)`;
  }
  return 'Shows when this machine is connected to the directory';
}

function SignInArea({ account }: { account: AccountView }) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  if (!account.canSignIn) {
    return (
      <p data-testid="account-sign-in-hint" className="text-xs text-muted-foreground">
        Sign in on this machine with <span className="font-mono">pan account login</span>.
      </p>
    );
  }

  if (account.signIn.state === 'pending' && account.signIn.authorizeUrl) {
    return (
      <div className="flex items-center gap-3">
        <a href={account.signIn.authorizeUrl} target="_blank" rel="noreferrer" className={PRIMARY_BUTTON}>
          Open overdeck.ai sign-in
        </a>
        <span className="text-xs text-muted-foreground">Waiting for sign-in…</span>
      </div>
    );
  }

  const signIn = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const result = await startAccountSignIn();
      if (!isOk(result)) {
        setStartError(apiError(result));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-1">
      <button type="button" className={PRIMARY_BUTTON} disabled={starting} onClick={() => void signIn()}>
        Sign in
      </button>
      {startError && <p className="text-xs text-destructive">{startError}</p>}
    </div>
  );
}

export function AccountCard() {
  const queryClient = useQueryClient();
  const { data: account, error, isLoading } = useQuery({
    queryKey: ACCOUNT_QUERY_KEY,
    queryFn: loadAccount,
    refetchInterval: (query) => (query.state.data?.signIn.state === 'pending' ? 2000 : false),
  });

  // A finished sign-in changes what the directory and status cards show; refresh them once.
  const previousSignInState = useRef<string | null>(null);
  const signInState = account?.signIn.state ?? null;
  useEffect(() => {
    if (signInState === 'succeeded' && previousSignInState.current !== null && previousSignInState.current !== 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: DIRECTORY_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY });
    }
    previousSignInState.current = signInState;
  }, [signInState, queryClient]);

  return (
    <section
      aria-labelledby="anywhere-account-title"
      data-component="anywhere-account-card"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h3 id="anywhere-account-title" className="text-sm font-medium text-foreground mb-2">Account</h3>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading account…</p>
      ) : error || !account ? (
        <p className="text-xs text-muted-foreground">Account status is unavailable.</p>
      ) : (
        <div className="space-y-3">
          {account.accountError && <p className="text-xs text-destructive">{account.accountError}</p>}
          {account.signedIn ? (
            <>
              <dl className="divide-y divide-border">
                <Row label="Signed in as">{account.githubLogin ?? 'Unknown'}</Row>
                <Row label="Plan">{planLabel(account.plan)}</Row>
                <Row label="Relay">
                  <span data-testid="account-relay">{relayText(account)}</span>
                </Row>
              </dl>
              {account.tokenRejected && (
                <p className="text-xs text-muted-foreground">overdeck.ai rejected this machine&apos;s sign-in.</p>
              )}
              <p className="text-xs text-muted-foreground">Paid plans are invite-only for now.</p>
              {account.manageUrl && (
                <a
                  data-testid="account-manage"
                  href={account.manageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs text-primary hover:underline"
                >
                  Manage account
                </a>
              )}
            </>
          ) : (
            !account.accountError && <p className="text-xs text-muted-foreground">Not signed in to overdeck.ai.</p>
          )}
          {account.signIn.state === 'failed' && account.signIn.message && (
            <p data-testid="account-sign-in-message" className="text-xs text-muted-foreground">{account.signIn.message}</p>
          )}
          {(!account.signedIn || account.tokenRejected) && <SignInArea account={account} />}
        </div>
      )}
    </section>
  );
}
