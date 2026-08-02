import React from 'react';
import { bucketCount, captureException } from './lib/telemetry';

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
 * Strategy: on a same-origin module/asset load failure, show a reconnecting
 * overlay, poll the origin until it serves again, then reload. Three reloads
 * within 15 seconds are allowed; the fourth trips a manual-recovery circuit
 * breaker. Each decision is reported through PostHog exception capture with a
 * categorical recovery action, trigger, reload-count bucket, and reload decision.
 * A tripped circuit breaker reports a second `frontend_recovery_reload_loop` action.
 */

const OVERLAY_ID = 'pan-recovery-overlay';
const LAST_RELOAD_KEY = 'pan.recovery.lastReload';
const RELOAD_COUNT_KEY = 'pan.recovery.reloadCount';
const RELOAD_WINDOW_MS = 15_000;
const MAX_CONSECUTIVE_RELOADS = 3;
let reconnecting = false;

export interface RecoveryDetails {
  trigger:
    | 'vite_preload_error'
    | 'asset_load_error'
    | 'window_module_error'
    | 'unhandled_rejection'
    | 'root_error_boundary';
  resource?: string;
  message?: string;
  stackHead?: string;
}

/** Does this error/reason look like a failed dynamic-import / module-script load? */
function errorMessage(reasonOrError: unknown): string {
  if (typeof reasonOrError === 'string') return reasonOrError;
  if (reasonOrError && typeof reasonOrError === 'object' && 'message' in reasonOrError) {
    return String((reasonOrError as { message?: unknown }).message ?? '');
  }
  return '';
}

function stackHead(reasonOrError: unknown): string | undefined {
  if (!reasonOrError || typeof reasonOrError !== 'object' || !('stack' in reasonOrError)) return undefined;
  const stack = String((reasonOrError as { stack?: unknown }).stack ?? '');
  return stack ? stack.split('\n').slice(0, 5).join('\n') : undefined;
}

export function isModuleLoadError(reasonOrError: unknown): boolean {
  const msg = errorMessage(reasonOrError).toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('module script failed') ||
    msg.includes('dynamically imported module')
  );
}

export function sameOriginResourceUrl(source: EventTarget | string | null): string | null {
  let rawUrl: string;
  if (typeof source === 'string') {
    rawUrl = source;
  } else {
    if (!(source instanceof HTMLElement) || (source.tagName !== 'SCRIPT' && source.tagName !== 'LINK')) {
      return null;
    }
    rawUrl = source.tagName === 'SCRIPT'
      ? (source as HTMLScriptElement).src
      : (source as HTMLLinkElement).href;
  }
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, window.location.href);
    return url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

function resourceFromMessage(message: string): string | undefined {
  const candidate = message.match(/(?:https?:\/\/|\/)[^\s'"<>]+/)?.[0].replace(/[),.;]+$/, '');
  return candidate ? sameOriginResourceUrl(candidate) ?? undefined : undefined;
}

export function recordRecoveryReload(now = Date.now()): { count: number; shouldReload: boolean } {
  const lastReload = Number(sessionStorage.getItem(LAST_RELOAD_KEY) || '0');
  const previousCount = Number(sessionStorage.getItem(RELOAD_COUNT_KEY) || '0');
  const count = now - lastReload < RELOAD_WINDOW_MS ? previousCount + 1 : 1;
  sessionStorage.setItem(LAST_RELOAD_KEY, String(now));
  sessionStorage.setItem(RELOAD_COUNT_KEY, String(count));
  return { count, shouldReload: count <= MAX_CONSECUTIVE_RELOADS };
}

export function captureRecoveryReload(
  details: RecoveryDetails,
  decision: { count: number; shouldReload: boolean },
): void {
  const error = new Error(details.message ?? 'Frontend recovery reload');
  if (details.stackHead) error.stack = details.stackHead;
  const context = {
    action: 'frontend_recovery_reload' as const,
    trigger: details.trigger,
    reload_count: bucketCount(decision.count),
    should_reload: decision.shouldReload,
  };
  captureException(error, context);
  if (!decision.shouldReload) {
    captureException(error, { ...context, action: 'frontend_recovery_reload_loop' });
  }
}

export function showOverlay(message: string, action?: { label: string; onClick: () => void }): void {
  document.getElementById(OVERLAY_ID)?.remove();
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
    'font-family:var(--font-sans),system-ui,sans-serif',
    'font-size:15px',
  ].join(';');
  el.innerHTML = `
    <div style="width:34px;height:34px;border:3px solid rgba(255,255,255,0.18);border-top-color:#6aa0ff;border-radius:50%;animation:pan-recovery-spin 0.8s linear infinite"></div>
    <div data-pan-recovery-message="true"></div>
    ${action ? '<button type="button" data-pan-recovery-action="true" style="padding:8px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#1b2533;color:#e6e6e6;cursor:pointer;font-size:14px"></button>' : ''}
    <style>@keyframes pan-recovery-spin{to{transform:rotate(360deg)}}</style>
  `;
  const messageEl = el.querySelector<HTMLElement>('[data-pan-recovery-message="true"]');
  if (messageEl) messageEl.textContent = message;
  if (action) {
    const button = el.querySelector<HTMLButtonElement>('[data-pan-recovery-action="true"]');
    if (button) {
      button.textContent = action.label;
      button.addEventListener('click', action.onClick);
    }
  }
  document.body.appendChild(el);
}

export function hideOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * Poll the origin until it serves again, then reload. Idempotent: concurrent
 * triggers collapse into a single in-flight reconnect.
 */
export async function waitForServerThenReload(details: RecoveryDetails): Promise<void> {
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
  const decision = recordRecoveryReload();
  captureRecoveryReload(details, decision);
  if (!decision.shouldReload) {
    const resource = details.resource ? ` Failing resource: ${details.resource}` : '';
    showOverlay(
      `The dashboard stopped automatic recovery after repeated load failures.${resource}`,
      { label: 'Reload dashboard', onClick: () => window.location.reload() },
    );
    return;
  }
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
    const error = (event as Event & { payload?: unknown }).payload;
    const message = errorMessage(error);
    void waitForServerThenReload({
      trigger: 'vite_preload_error',
      resource: resourceFromMessage(message),
      message: message || undefined,
      stackHead: stackHead(error),
    });
  });

  // A failed <script type="module"> or <link> surfaces as a window 'error'
  // whose target is the failing element (and does not bubble, hence capture).
  window.addEventListener(
    'error',
    (event) => {
      const resource = sameOriginResourceUrl(event.target);
      if (resource) {
        void waitForServerThenReload({
          trigger: 'asset_load_error',
          resource,
          message: event.message || 'Module asset failed to load',
        });
        return;
      }
      const error = event.error ?? event.message;
      if (isModuleLoadError(error)) {
        const message = errorMessage(error);
        void waitForServerThenReload({
          trigger: 'window_module_error',
          resource: resourceFromMessage(message),
          message: message || undefined,
          stackHead: stackHead(error),
        });
      }
    },
    true,
  );

  // Unhandled dynamic import() rejections.
  window.addEventListener('unhandledrejection', (event) => {
    if (isModuleLoadError(event.reason)) {
      const message = errorMessage(event.reason);
      void waitForServerThenReload({
        trigger: 'unhandled_rejection',
        resource: resourceFromMessage(message),
        message: message || undefined,
        stackHead: stackHead(event.reason),
      });
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
    captureException(error, {
      action: 'frontend_unhandled_error',
      trigger: 'root_error_boundary',
    });
    if (isModuleLoadError(error)) {
      const message = errorMessage(error);
      void waitForServerThenReload({
        trigger: 'root_error_boundary',
        resource: resourceFromMessage(message),
        message: message || undefined,
        stackHead: stackHead(error),
      });
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
          fontFamily: 'var(--font-sans),system-ui,sans-serif',
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
