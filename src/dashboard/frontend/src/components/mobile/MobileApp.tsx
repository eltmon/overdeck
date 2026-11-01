/**
 * MobileApp — the phone shell at `/m` (PAN-2355).
 *
 * D-3 Deep links are query parameters on `/m`, never path segments: the static
 *     server 404s a missing path with a file extension, so an id with a dot in
 *     a segment would break. `readMobileRoute` reads:
 *       /m                       → Needs-you list
 *       /m?subject=<id>          → Needs-you list with that subject's card open
 *       /m?tab=conversations     → conversation list
 *       /m?conversation=<id>     → that conversation, full screen
 * D-4 A standalone branch, lazy-loaded from App.tsx, with no desktop chrome
 *     (no Sidebar, Stage, terminals or dialog host). The desktop bundle gains
 *     only the lazy import.
 * D-6 The service worker is registered only from here, once on mount, in a
 *     secure production context. A failure logs one warning and never blocks
 *     the shell. PAN-2354's notifications control registers the same script
 *     and scope, so the two registrations stay idempotent.
 */
import { useCallback, useEffect, useState } from 'react';
import { EventRouter } from '../EventRouter';
import { useConnectionState } from '../../lib/connectionState';
import { TurnOnNotificationsButton } from '../push/TurnOnNotificationsButton';
import { MobileNeedsYou } from './MobileNeedsYou';
import { MobileConversations } from './MobileConversations';
import { MobilePairScreen } from './MobilePairScreen';

export type MobileTab = 'needs-you' | 'conversations';

export interface MobileRoute {
  tab: MobileTab;
  subjectId: string | null;
  conversationId: string | null;
}

export function readMobileRoute(search: string): MobileRoute {
  const params = new URLSearchParams(search);
  const conversationId = params.get('conversation') || null;
  if (conversationId) return { tab: 'conversations', subjectId: null, conversationId };
  if (params.get('tab') === 'conversations') return { tab: 'conversations', subjectId: null, conversationId: null };
  return { tab: 'needs-you', subjectId: params.get('subject') || null, conversationId: null };
}

function mobileSearch(route: MobileRoute): string {
  const params = new URLSearchParams();
  if (route.conversationId) params.set('conversation', route.conversationId);
  else if (route.tab === 'conversations') params.set('tab', 'conversations');
  else if (route.subjectId) params.set('subject', route.subjectId);
  const search = params.toString();
  return search ? `?${search}` : '';
}

function navigateMobile(route: MobileRoute): void {
  const path = `/m${mobileSearch(route)}`;
  if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function useMobileRoute(): MobileRoute {
  const [route, setRoute] = useState(() => readMobileRoute(window.location.search));
  useEffect(() => {
    const onPopState = () => setRoute(readMobileRoute(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return route;
}

function useServiceWorkerRegistration(): void {
  useEffect(() => {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err: unknown) => {
      console.warn('[mobile] service worker registration failed', err);
    });
  }, []);
}

/** The Chromium install event; not in the DOM lib types. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // Other iOS browsers (CriOS, FxiOS, EdgiOS) cannot add a web app to the home screen.
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function InstallAffordance() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone] = useState(isStandalone);
  const [iosSafari] = useState(isIosSafari);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const install = useCallback(() => {
    if (!installEvent) return;
    setInstallEvent(null);
    void installEvent.prompt();
  }, [installEvent]);

  if (standalone) return null;
  if (installEvent) {
    return (
      <button
        type="button"
        onClick={install}
        className="min-h-11 min-w-11 rounded-sm border border-border px-3 text-sm font-medium text-foreground"
      >
        Install app
      </button>
    );
  }
  if (iosSafari) {
    return <p className="text-xs text-muted-foreground">To install, tap Share, then Add to Home Screen</p>;
  }
  return null;
}

const TABS: ReadonlyArray<{ tab: MobileTab; label: string }> = [
  { tab: 'needs-you', label: 'Needs you' },
  { tab: 'conversations', label: 'Conversations' },
];

export default function MobileApp() {
  const route = useMobileRoute();
  const sessionAuthFailed = useConnectionState((s) => s.sessionAuthFailed);
  useServiceWorkerRegistration();

  const openConversation = useCallback((id: string) => {
    navigateMobile({ tab: 'conversations', subjectId: null, conversationId: id });
  }, []);
  const closeConversation = useCallback(() => {
    navigateMobile({ tab: 'conversations', subjectId: null, conversationId: null });
  }, []);

  const fullScreenConversation = route.tab === 'conversations' && route.conversationId !== null;

  return (
    // fixed: the shell never makes the document overflow, so a phone never pans or zooms the page.
    <div data-component="mobile-app" className="fixed inset-0 flex flex-col bg-background text-foreground">
      <EventRouter />
      {sessionAuthFailed ? (
        <MobilePairScreen />
      ) : (
        <>
          {!fullScreenConversation && (
            <header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 pt-[env(safe-area-inset-top)]">
              <h1 className="text-base font-medium">Overdeck</h1>
              {/* PAN-2354's control, sized up to the phone's 44 px tap target from here. */}
              <div className="flex items-center gap-2 [&_button]:min-h-11 [&_button]:min-w-11">
                <InstallAffordance />
                <TurnOnNotificationsButton compact />
              </div>
            </header>
          )}
          <main className="min-h-0 flex-1 overflow-y-auto">
            {route.tab === 'needs-you' ? (
              <MobileNeedsYou subjectId={route.subjectId} />
            ) : (
              <MobileConversations
                conversationId={route.conversationId}
                onOpen={openConversation}
                onBack={closeConversation}
              />
            )}
          </main>
          {!fullScreenConversation && (
            <nav
              aria-label="Phone sections"
              className="flex border-t border-border pb-[env(safe-area-inset-bottom)]"
            >
              {TABS.map(({ tab, label }) => (
                <button
                  key={tab}
                  type="button"
                  aria-current={route.tab === tab ? 'page' : undefined}
                  onClick={() => navigateMobile({ tab, subjectId: null, conversationId: null })}
                  className={`min-h-11 min-w-11 flex-1 text-sm ${
                    route.tab === tab ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
