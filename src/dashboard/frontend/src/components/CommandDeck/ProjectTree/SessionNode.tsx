import { useState, useCallback, useRef, useEffect } from 'react';
import { useLiveFlash } from '../../../lib/useLiveFlash';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import styles from '../styles/command-deck.module.css';

interface SessionNodeProps {
  session: SessionNodeType;
  issueId?: string;
  isSelected?: boolean;
  onClick?: () => void;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
  onPauseSession?: (sessionId: string) => void;
  onResumeSession?: (sessionId: string) => void;
  onRestartSession?: (sessionId: string, issueId: string) => void;
  onDeepWipe?: (issueId: string) => void;
  onOpenStateDir?: (sessionId: string) => void;
  onViewJsonl?: (sessionId: string) => void;
}

function PresenceDot({ presence }: { presence: SessionNodeType['presence'] }) {
  if (presence === 'active') {
    return (
      <span className={styles.sessionPresence}>
        <svg
          className={styles.sessionPresenceSpinner}
          width="10"
          height="10"
          viewBox="0 0 10 10"
        >
          <circle
            cx="5"
            cy="5"
            r="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="16"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  const className =
    presence === 'idle'
      ? styles.sessionPresenceIdle
      : styles.sessionPresenceEnded;

  return <span className={`${styles.sessionPresence} ${className}`} />;
}

function TypeBadge({ type, role }: { type: SessionNodeType['type']; role?: string }) {
  const label = role && type === 'reviewer' ? `${type}:${role}` : type;
  return <span className={styles.sessionTypeBadge}>{label}</span>;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function deriveSessionLabel(session: SessionNodeType): string {
  const model = session.model && session.model !== 'unknown' && session.model !== 'specialist'
    ? session.model
    : '';
  switch (session.type) {
    case 'merge': return 'Merge agent';
    case 'test': return 'Tests';
    case 'review': return 'Review';
    case 'reviewer': return session.role ? `${capitalize(session.role)} reviewer` : 'Reviewer';
    case 'work': return model ? `Work agent (${model})` : 'Work agent';
    case 'planning': return model ? `Planning (${model})` : 'Planning';
    case 'legacy': return 'Planning state';
    default: return session.type;
  }
}

interface ContextMenuState {
  x: number;
  y: number;
  open: boolean;
}

function MenuItem({
  label,
  onClick,
  variant = 'default',
}: {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
}) {
  return (
    <button
      style={{
        display: 'block',
        width: '100%',
        padding: '6px 12px',
        border: 'none',
        background: 'none',
        textAlign: 'left',
        cursor: 'pointer',
        color: variant === 'danger' ? 'var(--mc-error, #ef4444)' : 'var(--foreground)',
        fontSize: 12,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function MenuDivider() {
  return (
    <div
      style={{
        height: 1,
        background: 'var(--mc-border, var(--border))',
        margin: '4px 8px',
      }}
    />
  );
}

export function SessionNode({
  session,
  issueId,
  isSelected,
  onClick,
  onStopSession,
  onViewTerminal,
  onPauseSession,
  onResumeSession,
  onRestartSession,
  onDeepWipe,
  onOpenStateDir,
  onViewJsonl,
}: SessionNodeProps) {
  const [menu, setMenu] = useState<ContextMenuState>({ x: 0, y: 0, open: false });
  const menuRef = useRef<HTMLDivElement>(null);

  // Live flash when presence or status changes (blocker-8)
  const flashKey = `${session.sessionId}:${session.presence}:${session.status}`;
  const flashClass = useLiveFlash(flashKey, 'anim-row-flash', 600);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, open: true });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu((m) => ({ ...m, open: false }));
  }, []);

  // Close menu on click outside or scroll
  useEffect(() => {
    if (!menu.open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const handleScroll = () => closeMenu();
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [menu.open, closeMenu]);

  const canPause = session.presence === 'active' && onPauseSession;
  const canResume = session.presence === 'suspended' && onResumeSession;
  const canStop = (session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended') && onStopSession;
  const canRestart = onRestartSession && issueId != null;
  const canDeepWipe = onDeepWipe && issueId != null;
  const hasLifecycleActions = canPause || canResume || canStop || canRestart;

  const handleDeepWipe = useCallback(() => {
    if (!issueId || !onDeepWipe) return;
    const confirmed = window.confirm(
      `Deep wipe will destroy all data for ${issueId} including workspace, state, and git branches. This cannot be undone.\n\nAre you absolutely sure?`,
    );
    if (confirmed) {
      onDeepWipe(issueId);
    }
    closeMenu();
  }, [issueId, onDeepWipe, closeMenu]);

  return (
    <>
      <button
        className={`${styles.sessionNode} ${isSelected ? styles.sessionNodeSelected : ''} ${flashClass}`}
        onClick={onClick}
        onContextMenu={handleContextMenu}
      >
        <PresenceDot presence={session.presence} />
        <TypeBadge type={session.type} role={session.role} />
        <span className={styles.sessionLabel} title={session.sessionId}>
          {deriveSessionLabel(session)}
        </span>
        <span className={`${styles.sessionStatus} ${styles[`sessionStatus_${session.status}`] ?? ''}`}>
          {session.status}
        </span>
        <span className={styles.sessionDuration}>{formatDuration(session.duration)}</span>
      </button>

      {menu.open && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 1000,
            background: 'var(--card)',
            border: '1px solid var(--mc-border, var(--border))',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
            minWidth: 160,
            fontSize: 12,
          }}
        >
          {/* Lifecycle actions */}
          {canPause && (
            <MenuItem
              label="Pause"
              onClick={() => {
                onPauseSession!(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {canResume && (
            <MenuItem
              label="Resume"
              onClick={() => {
                onResumeSession!(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {canStop && (
            <MenuItem
              label="Stop"
              onClick={() => {
                onStopSession!(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {canRestart && (
            <MenuItem
              label="Restart"
              onClick={() => {
                onRestartSession!(session.sessionId, issueId!);
                closeMenu();
              }}
            />
          )}

          {hasLifecycleActions && canDeepWipe && <MenuDivider />}

          {/* Destructive */}
          {canDeepWipe && (
            <MenuItem label="Deep Wipe" variant="danger" onClick={handleDeepWipe} />
          )}

          {(hasLifecycleActions || canDeepWipe) && (onOpenStateDir || onViewJsonl) && <MenuDivider />}

          {/* Utility */}
          {onOpenStateDir && (
            <MenuItem
              label="Open State Dir"
              onClick={() => {
                onOpenStateDir(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {onViewJsonl && session.hasJsonl && (
            <MenuItem
              label="View JSONL"
              onClick={() => {
                onViewJsonl(session.sessionId);
                closeMenu();
              }}
            />
          )}
          {onViewTerminal && (
            <MenuItem
              label="View Terminal"
              onClick={() => {
                onViewTerminal(session.sessionId);
                closeMenu();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
