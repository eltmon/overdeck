import React from 'react';

/**
 * Front-end self-recovery for dashboard restarts.
 *
 * When `pan dev` (or `pan reload`) restarts the server, a browser tab that is
 * already open can try to fetch a JS module / asset that briefly 404s — the
 * server is mid-restart, or a rebuild gave the chunk a new hash. With no
 * handling that throws unhandled and React blanks the page (the symptom: a
 * blank screen with a 404 in the console).
 *
 * The WebSocket RPC layer already auto-reconnects *data*; this recovers *asset*
 * load failures, which it cannot. The logic is deliberately framework-free
 * (raw DOM overlay + fetch) so it still works when a module error has taken
 * React down with it.
 *
 * Strategy: on a module/asset load failure, show a "Reconnecting…" overlay,
 * poll the origin until it serves again, then reload once. A sessionStorage
 * guard prevents a reload storm if the reloaded page fails immediately too.
 */

const OVERLAY_ID = 'pan-recovery-overlay';
const LAST_RELOAD_KEY = 'pan.recovery.lastReload';
let reconnecting = false;

/** Does this error/reason look like a failed dynamic-import / module-script load? */
export function isModuleLoadError(reasonOrError: unknown): boolean {
  let msg = '';
  if (typeof reasonOrError === 'string') {
    msg = reasonOrError;
  } else if (reasonOrError && typeof reasonOrError === 'object' && 'message' in reasonOrError) {
    msg = String((reasonOrError as { message?: unknown }).message ?? '');
  }
  msg = msg.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('module script failed') ||
    msg.includes('dynamically imported module')
  );
}

function showOverlay(message: string): void {
  if (document.getElementById(OVERLAY_ID)) return;
  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:16px',
    'background:rgba(10,12,16,0.92)',
    'color:#e6e6e6',
    "font-family:'DM Sans',system-ui,sans-serif",
    'font-size:15px',
  ].join(';');
  el.innerHTML = `
    <div style="width:34px;height:34px;border:3px solid rgba(255,255,255,0.18);border-top-color:#6aa0ff;border-radius:50%;animation:pan-recovery-spin 0.8s linear infinite"></div>
    <div>${message}</div>
    <style>@keyframes pan-recovery-spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(el);
}

/**
 * Poll the origin until it serves again, then reload. Idempotent: concurrent
 * triggers collapse into a single in-flight reconnect.
 */
export async function waitForServerThenReload(): Promise<void> {
  if (reconnecting) return;
  reconnecting = true;
  showOverlay('Reconnecting to the dashboard…');

  const lastReload = Number(sessionStorage.getItem(LAST_RELOAD_KEY) || '0');

  for (let attempt = 0; ; attempt++) {
    try {
      // Origin-relative so it works in dev (Vite) and prod (static) without
      // knowing ports. `no-store` defeats any cached 200.
      const res = await fetch('/', { cache: 'no-store' });
      if (res.ok) break;
    } catch {
      // server still down — keep polling
    }
    await sleep(Math.min(500 + attempt * 250, 3000));
  }

  // If we reloaded very recently and are already failing again, the new page is
  // also broken — wait before reloading so we don't hammer in a tight loop.
  if (Date.now() - lastReload < 4000) {
    await sleep(2000);
  }
  sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wire global listeners for asset/module load failures. Call once before render. */
export function installRecovery(): void {
  // Vite fires this on the window when a dynamically-imported chunk fails to
  // load (the canonical "asset 404 after restart/rebuild" signal).
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    void waitForServerThenReload();
  });

  // A failed <script type="module"> or <link> surfaces as a window 'error'
  // whose target is the failing element (and does not bubble, hence capture).
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        void waitForServerThenReload();
        return;
      }
      if (isModuleLoadError(event.error ?? event.message)) {
        void waitForServerThenReload();
      }
    },
    true,
  );

  // Unhandled dynamic import() rejections.
  window.addEventListener('unhandledrejection', (event) => {
    if (isModuleLoadError(event.reason)) {
      void waitForServerThenReload();
    }
  });
}

/**
 * Top-level boundary so a render crash isn't a permanent blank page. A module
 * load error self-recovers (poll + reload); any other crash shows a fallback
 * with a manual reload — we don't auto-reload generic crashes to avoid looping
 * on a genuine app bug.
 */
export class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    if (isModuleLoadError(error)) {
      void waitForServerThenReload();
    }
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: 'rgba(10,12,16,0.92)',
          color: '#e6e6e6',
          fontFamily: "'DM Sans',system-ui,sans-serif",
          fontSize: 15,
        }}
      >
        <div>The dashboard hit an error.</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 18px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.2)',
            background: '#1b2533',
            color: '#e6e6e6',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Reload dashboard
        </button>
      </div>
    );
  }
}
