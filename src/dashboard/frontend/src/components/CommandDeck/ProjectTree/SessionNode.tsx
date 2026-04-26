import { useState, useCallback, useRef, useEffect } from 'react';
import { useLiveFlash } from '../../../lib/useLiveFlash';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import styles from '../styles/command-deck.module.css';

interface SessionNodeProps {
  session: SessionNodeType;
  isSelected?: boolean;
  onClick?: () => void;
  onStopSession?: (sessionId: string) => void;
  onViewTerminal?: (sessionId: string) => void;
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

interface ContextMenuState {
  x: number;
  y: number;
  open: boolean;
}

export function SessionNode({ session, isSelected, onClick, onStopSession, onViewTerminal }: SessionNodeProps) {
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
    setMenu(m => ({ ...m, open: false }));
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

  const canStop = session.presence === 'active' || session.presence === 'idle';

  return (
    <>
      <button
        className={`${styles.sessionNode} ${isSelected ? styles.sessionNodeSelected : ''} ${flashClass}`}
        onClick={onClick}
        onContextMenu={handleContextMenu}
      >
        <PresenceDot presence={session.presence} />
        <TypeBadge type={session.type} role={session.role} />
        <span className={styles.sessionId} title={session.sessionId}>
          {session.sessionId}
        </span>
        <span className={styles.sessionModel} title={session.model}>
          {session.model}
        </span>
        <span className={styles.sessionStatus}>{session.status}</span>
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
            minWidth: 140,
            fontSize: 12,
          }}
        >
          {canStop && onStopSession && (
            <button
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--foreground)',
                fontSize: 12,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={() => {
                onStopSession(session.sessionId);
                closeMenu();
              }}
            >
              Stop session
            </button>
          )}
          {onViewTerminal && (
            <button
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--foreground)',
                fontSize: 12,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={() => {
                onViewTerminal(session.sessionId);
                closeMenu();
              }}
            >
              View terminal
            </button>
          )}
        </div>
      )}
    </>
  );
}
