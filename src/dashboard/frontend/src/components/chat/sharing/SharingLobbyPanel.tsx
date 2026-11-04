/**
 * The lobby panel inside the share dialog (PAN-4473 WI-7, FR-9). A pure render of one `ShareView`:
 * people waiting to join, people in the room and blocked identities, each with the host's actions.
 * Every button maps to exactly one share command. Actions are disabled unless the host socket is
 * connected.
 *
 * Control (PAN-4478 WI-7): `LobbyRoster` is the presentational roster, shared with the viewer-controller
 * panel. While the data owner controls, each admitted row offers **Hand control**; while a viewer
 * controls, the panel says who has control, offers one **Reclaim control** and no other action.
 */
import type { ShareCommand, ShareIdentity, ShareLastError, ShareView } from '@overdeck/contracts';
import type { ReactNode } from 'react';

/** One roster row: a snapshot participant (host) or a presence participant (viewer-controller). */
export interface LobbyPerson extends ShareIdentity {
  readonly state: 'lobby' | 'admitted';
  readonly contributor: boolean;
  readonly connected?: boolean; // absent on the viewer (presence has no `connected`)
}

export interface LobbyRosterProps {
  people: readonly LobbyPerson[];
  /** null hides the Blocked section (viewer-controller, D-7). */
  blocked: readonly ShareIdentity[] | null;
  controllerGithubId: number;
  /** The person looking at the panel: never shown actions against themself. */
  selfGithubId: number;
  /** False: rows render without action buttons. */
  canAct: boolean;
  disabled: boolean;
  onCommand: (command: ShareCommand) => void;
}

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

export function LobbyRoster({ people, blocked, controllerGithubId, selfGithubId, canAct, disabled, onCommand }: LobbyRosterProps) {
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
  const acts = (p: ShareIdentity) => canAct && p.githubId !== selfGithubId;

  const lobby = people.filter((p) => p.state === 'lobby');
  const admitted = people.filter((p) => p.state === 'admitted');

  const admittedMarkers = (p: LobbyPerson) => (
    <>
      {p.contributor && <span className={MARKER}>contributor</span>}
      {p.connected === false && <span className={MARKER}>offline</span>}
      {p.githubId === controllerGithubId && <span className={MARKER}>controller</span>}
    </>
  );

  return (
    <>
      <Section title="Waiting to join" count={lobby.length}>
        {lobby.map((p) => (
          <Person key={p.githubId} identity={p}>
            {acts(p) && (
              <>
                {action('Admit', `Admit @${p.login}`, { type: 'admit', githubId: p.githubId })}
                {action('Admit as contributor', `Admit @${p.login} as contributor`, { type: 'admit', githubId: p.githubId, contributor: true })}
                {action('Revoke', `Revoke @${p.login}`, { type: 'revoke', githubId: p.githubId }, true)}
              </>
            )}
          </Person>
        ))}
      </Section>
      <Section title="In the room" count={admitted.length}>
        {admitted.map((p) => (
          <Person key={p.githubId} identity={p} markers={admittedMarkers(p)}>
            {acts(p) && (
              <>
                {p.contributor
                  ? action('Remove contributor', `Remove contributor from @${p.login}`, { type: 'set-contributor', githubId: p.githubId, contributor: false })
                  : action('Grant contributor', `Grant contributor to @${p.login}`, { type: 'set-contributor', githubId: p.githubId, contributor: true })}
                {action('Hand control', `Hand control to @${p.login}`, { type: 'set-controller', githubId: p.githubId })}
                {action('Kick', `Kick @${p.login}`, { type: 'kick', githubId: p.githubId })}
                {action('Revoke', `Revoke @${p.login}`, { type: 'revoke', githubId: p.githubId }, true)}
              </>
            )}
          </Person>
        ))}
      </Section>
      {blocked && (
        <Section title="Blocked" count={blocked.length}>
          {blocked.map((identity) => (
            <Person key={identity.githubId} identity={identity}>
              {acts(identity) && action('Un-revoke', `Un-revoke @${identity.login}`, { type: 'unrevoke', githubId: identity.githubId })}
            </Person>
          ))}
        </Section>
      )}
    </>
  );
}

export function SharingLobbyPanel({ share, onCommand, pending = false }: SharingLobbyPanelProps) {
  const disabled = share.connection !== 'connected' || pending;
  const snapshot = share.snapshot;

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

  const owner = snapshot.dataOwner.githubId;
  const controller = share.controllerGithubId ?? snapshot.controllerGithubId;
  const ownerControls = controller === owner;
  const controllerLogin = snapshot.participants.find((p) => p.githubId === controller)?.login;
  const empty = snapshot.participants.length === 0 && snapshot.blocked.length === 0;

  return (
    <div className="space-y-3" data-component="sharing-lobby">
      {alert}
      {!ownerControls && (
        <div className="flex items-center gap-2">
          <p role="status" className="min-w-0 truncate text-xs text-muted-foreground">
            {controllerLogin ? `@${controllerLogin}` : 'Another participant'} has control.
          </p>
          <button
            type="button"
            className={`${NEUTRAL_BUTTON} ml-auto shrink-0`}
            aria-label="Reclaim control"
            disabled={disabled}
            onClick={() => onCommand({ type: 'set-controller', githubId: owner })}
          >
            Reclaim control
          </button>
        </div>
      )}
      {empty ? (
        <p className="text-xs text-muted-foreground">
          No one has joined yet. People who open the link wait here until you admit them.
        </p>
      ) : (
        <LobbyRoster
          people={snapshot.participants}
          blocked={snapshot.blocked}
          controllerGithubId={controller}
          selfGithubId={owner}
          canAct={ownerControls}
          disabled={disabled}
          onCommand={onCommand}
        />
      )}
    </div>
  );
}
