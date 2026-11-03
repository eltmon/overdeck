/**
 * The lobby panel inside the share dialog (PAN-4473 WI-7, FR-9). A pure render of one `ShareView`:
 * people waiting to join, people in the room and blocked identities, each with the host's actions.
 * Every button maps to exactly one share command; the host never sees a button that the share
 * service would refuse in this slice. Actions are disabled unless the host socket is connected.
 */
import type { RoomParticipant, ShareCommand, ShareIdentity, ShareLastError, ShareView } from '@overdeck/contracts';
import type { ReactNode } from 'react';

export interface SharingLobbyPanelProps {
  share: ShareView;
  onCommand: (command: ShareCommand) => void;
  pending?: boolean;
}

const NEUTRAL_BUTTON =
  'rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const DESTRUCTIVE_BUTTON =
  'rounded-md border border-destructive/32 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/8 disabled:cursor-not-allowed disabled:opacity-50';
const MARKER = 'rounded-md border border-border px-1.5 text-[11px] leading-4 text-muted-foreground';

export function lastErrorMessage(error: ShareLastError): string {
  switch (error.code) {
    case 'unknown_participant': return 'That person is no longer in the room.';
    case 'not_admitted': return 'That person has not been admitted yet.';
    case 'replaced': return 'Another Overdeck process took over this share.';
    default: return `The share service reported ${error.code}.`;
  }
}

function Person({ identity, markers, children }: { identity: ShareIdentity; markers?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 py-1" data-github-id={identity.githubId}>
      <img src={identity.avatarUrl} alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-sm" />
      <span className="min-w-0 truncate font-mono text-xs">@{identity.login}</span>
      {markers}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">{children}</span>
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-medium text-muted-foreground">{title} ({count})</h3>
      <ul className="mt-1">{children}</ul>
    </section>
  );
}

export function SharingLobbyPanel({ share, onCommand, pending = false }: SharingLobbyPanelProps) {
  const disabled = share.connection !== 'connected' || pending;
  const snapshot = share.snapshot;
  const action = (label: string, ariaLabel: string, command: ShareCommand, destructive = false) => (
    <button
      type="button"
      className={destructive ? DESTRUCTIVE_BUTTON : NEUTRAL_BUTTON}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCommand(command)}
    >
      {label}
    </button>
  );

  const alert = share.lastError ? (
    <p role="alert" className="text-xs text-destructive">{lastErrorMessage(share.lastError)}</p>
  ) : null;

  if (!snapshot) {
    return (
      <div className="space-y-2" data-component="sharing-lobby">
        {alert}
        <p className="text-xs text-muted-foreground">The lobby shows up once the share service connects.</p>
      </div>
    );
  }

  const lobby = snapshot.participants.filter((p) => p.state === 'lobby');
  const admitted = snapshot.participants.filter((p) => p.state === 'admitted');
  const blocked = snapshot.blocked;
  const empty = snapshot.participants.length === 0 && blocked.length === 0;

  const admittedMarkers = (p: RoomParticipant) => (
    <>
      {p.contributor && <span className={MARKER}>contributor</span>}
      {!p.connected && <span className={MARKER}>offline</span>}
      {p.githubId === snapshot.controllerGithubId && <span className={MARKER}>controller</span>}
    </>
  );

  return (
    <div className="space-y-3" data-component="sharing-lobby">
      {alert}
      {empty ? (
        <p className="text-xs text-muted-foreground">
          No one has joined yet. People who open the link wait here until you admit them.
        </p>
      ) : (
        <>
          <Section title="Waiting to join" count={lobby.length}>
            {lobby.map((p) => (
              <Person key={p.githubId} identity={p}>
                {action('Admit', `Admit @${p.login}`, { type: 'admit', githubId: p.githubId })}
                {action('Admit as contributor', `Admit @${p.login} as contributor`, { type: 'admit', githubId: p.githubId, contributor: true })}
                {action('Revoke', `Revoke @${p.login}`, { type: 'revoke', githubId: p.githubId }, true)}
              </Person>
            ))}
          </Section>
          <Section title="In the room" count={admitted.length}>
            {admitted.map((p) => (
              <Person key={p.githubId} identity={p} markers={admittedMarkers(p)}>
                {p.contributor
                  ? action('Remove contributor', `Remove contributor from @${p.login}`, { type: 'set-contributor', githubId: p.githubId, contributor: false })
                  : action('Grant contributor', `Grant contributor to @${p.login}`, { type: 'set-contributor', githubId: p.githubId, contributor: true })}
                {action('Kick', `Kick @${p.login}`, { type: 'kick', githubId: p.githubId })}
                {action('Revoke', `Revoke @${p.login}`, { type: 'revoke', githubId: p.githubId }, true)}
              </Person>
            ))}
          </Section>
          <Section title="Blocked" count={blocked.length}>
            {blocked.map((identity) => (
              <Person key={identity.githubId} identity={identity}>
                {action('Un-revoke', `Un-revoke @${identity.login}`, { type: 'unrevoke', githubId: identity.githubId })}
              </Person>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
