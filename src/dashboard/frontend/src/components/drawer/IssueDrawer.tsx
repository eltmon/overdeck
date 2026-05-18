/**
 * IssueDrawer — slide-out issue detail overlay (PAN-1148)
 *
 * Single-instance drawer pinned to the right edge.
 * Opening a new issue while one is open replaces the prior one (no stacking).
 */

import { useEffect, useCallback } from 'react';
import { useDashboardStore } from '../../lib/store';

export function IssueDrawer() {
  const issueId = useDashboardStore((s) => s.drawerIssueId);
  const closeDrawer = useDashboardStore((s) => s.closeDrawerIssue);

  const handleClose = useCallback(() => {
    closeDrawer();
  }, [closeDrawer]);

  // Close on Escape
  useEffect(() => {
    if (!issueId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [issueId, handleClose]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!issueId) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [issueId]);

  if (!issueId) return null;

  return (
    <div
      data-testid="issue-drawer"
      data-drawer-open="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* Scrim */}
      <div
        data-testid="issue-drawer-scrim"
        onClick={handleClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.25)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Drawer panel */}
      <div
        data-testid="issue-drawer-panel"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 'min(980px, calc(100vw - 48px))',
          height: '100%',
          background: 'var(--background)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-24px 0 64px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'issueDrawerSlideIn 200ms ease-in-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {issueId}
          </span>
          <button
            data-testid="issue-drawer-close"
            onClick={handleClose}
            aria-label="Close drawer"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 18,
              color: 'var(--muted-foreground)',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content placeholder — detail tabs wired by future beads */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: 'var(--muted-foreground)',
              textAlign: 'center',
              marginTop: 40,
            }}
          >
            Issue detail for {issueId}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes issueDrawerSlideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
