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
 *       /m/pipeline              → pipeline board (PAN-4661)
 *       /m/pipeline?issue=<id>   → that issue's read-only sheet, full screen
 *     `pipeline` is a fixed path segment (no dot, no extension), so PAN-2355
 *     D-3 still holds: ids stay in the query.
 * D-4 A standalone branch, lazy-loaded from App.tsx, with no desktop chrome
 *     (no Sidebar, Stage, terminals or dialog host). The desktop bundle gains
 *     only the lazy import.
 * D-6 The service worker is registered only from here, once on mount, in a
 *     secure production context. A failure logs one warning and never blocks
 *     the shell. PAN-2354's notifications control registers the same script
 *     and scope, so the two registrations stay idempotent.
 */
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Inbox, ListOrdered, type LucideIcon, MessageSquare, Settings } from 'lucide-react';
import { EventRouter } from '../EventRouter';
import { useConnectionState } from '../../lib/connectionState';
import { isNativeShell } from '../../lib/nativeShell';
import { MobileNeedsYou } from './MobileNeedsYou';
import { MobileConversations } from './MobileConversations';
import { LogoWatermark, MobileScreenHeader, OverdeckLockup } from './brand';
import { LogoSting } from './LogoSting';
import { MobileHintsBanner, MobileSettingsSheet, useInstallPrompt } from './MobileChrome';
import { useMobileAppearance } from './useMobileAppearance';
import { MobileIssueSheet } from './MobileIssueSheet';
import { MobilePairScreen } from './MobilePairScreen';
import { MobilePipeline } from './MobilePipeline';

export type MobileTab = 'needs-you' | 'conversations' | 'pipeline';

export interface MobileRoute {
  tab: MobileTab;
  subjectId: string | null;
  conversationId: string | null;
  issueId: string | null;
}

// D-4661-3: a pipeline pathname decides the tab and ignores every other query
// parameter; otherwise the existing rules apply, with issueId always null.
export function readMobileRoute(search: string, pathname = '/m'): MobileRoute {
  const params = new URLSearchParams(search);
  if (pathname === '/m/pipeline' || pathname === '/m/pipeline/') {
    return { tab: 'pipeline', issueId: params.get('issue') || null, subjectId: null, conversationId: null };
  }
  const conversationId = params.get('conversation') || null;
  if (conversationId) return { tab: 'conversations', subjectId: null, conversationId, issueId: null };
  if (params.get('tab') === 'conversations') return { tab: 'conversations', subjectId: null, conversationId: null, issueId: null };
  return { tab: 'needs-you', subjectId: params.get('subject') || null, conversationId: null, issueId: null };
}

function mobilePath(route: MobileRoute): string {
  if (route.tab === 'pipeline') {
    return `/m/pipeline${route.issueId ? `?issue=${encodeURIComponent(route.issueId)}` : ''}`;
  }
  const params = new URLSearchParams();
  if (route.conversationId) params.set('conversation', route.conversationId);
  else if (route.tab === 'conversations') params.set('tab', 'conversations');
  else if (route.subjectId) params.set('subject', route.subjectId);
  const search = params.toString();
  return `/m${search ? `?${search}` : ''}`;
}

function navigateMobile(route: MobileRoute): void {
  const path = mobilePath(route);
  if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function useMobileRoute(): MobileRoute {
  const [route, setRoute] = useState(() => readMobileRoute(window.location.search, window.location.pathname));
  useEffect(() => {
    const onPopState = () => setRoute(readMobileRoute(window.location.search, window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return route;
}

function useServiceWorkerRegistration(): void {
  useEffect(() => {
    // The phone app (PAN-4837) is a native shell: no service worker.
    if (isNativeShell() || !window.isSecureContext || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err: unknown) => {
      console.warn('[mobile] service worker registration failed', err);
    });
  }, []);
}

const TABS: ReadonlyArray<{ tab: MobileTab; label: string; icon: LucideIcon }> = [
  { tab: 'needs-you', label: 'Needs you', icon: Inbox },
  { tab: 'conversations', label: 'Conversations', icon: MessageSquare },
  { tab: 'pipeline', label: 'Pipeline', icon: ListOrdered },
];

/**
 * `headerSlot`: in the phone app (PAN-4837 D-9) the header renders it in place
 * of the Settings button (PAN-5208 D-7); the PWA ignores it.
 */
export default function MobileApp({ headerSlot }: { headerSlot?: ReactNode } = {}) {
  const native = isNativeShell();
  const route = useMobileRoute();
  const sessionAuthFailed = useConnectionState((s) => s.sessionAuthFailed);
  const hasSnapshot = useConnectionState((s) => s.hasSnapshot);
  // PAN-5208 D-10: a deep-link open (read once, from the first route) skips the logo sting.
  const [initialDeepLink] = useState(() => route.subjectId !== null || route.conversationId !== null || route.issueId !== null);
  useServiceWorkerRegistration();
  // The /m web shell's System/Light/Dark (PAN-5208 D-6); a no-op in the phone app.
  useMobileAppearance();
  // Once, from the first render: the install event fires only near page load.
  const installPrompt = useInstallPrompt();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const openConversation = useCallback((id: string) => {
    navigateMobile({ tab: 'conversations', subjectId: null, conversationId: id, issueId: null });
  }, []);
  const closeConversation = useCallback(() => {
    navigateMobile({ tab: 'conversations', subjectId: null, conversationId: null, issueId: null });
  }, []);
  const openIssue = useCallback((id: string) => {
    navigateMobile({ tab: 'pipeline', subjectId: null, conversationId: null, issueId: id });
  }, []);
  const closeIssue = useCallback(() => {
    navigateMobile({ tab: 'pipeline', subjectId: null, conversationId: null, issueId: null });
  }, []);

  // D-4661-9: an open conversation or an open issue sheet is full screen, like
  // the shell header and tab bar hide for either.
  const fullScreen = (route.tab === 'conversations' && route.conversationId !== null)
    || (route.tab === 'pipeline' && route.issueId !== null);

  return (
    // fixed: the shell never makes the document overflow, so a phone never pans or zooms the page.
    <div data-component="mobile-app" className="fixed inset-0 flex flex-col bg-background text-foreground">
      <EventRouter />
      {sessionAuthFailed && !native ? (
        <MobilePairScreen />
      ) : (
        <>
          {!fullScreen && (
            <MobileScreenHeader
              leading={<OverdeckLockup className="h-6" />}
              trailing={
                native ? (
                  // The phone app's machine button, sized up to the phone's 44 px tap target.
                  <div className="flex items-center gap-2 [&_button]:min-h-11 [&_button]:min-w-11">{headerSlot}</div>
                ) : (
                  <button
                    type="button"
                    aria-label="Settings"
                    onClick={() => setSettingsOpen(true)}
                    className="-mr-2 flex min-h-11 min-w-11 items-center justify-center text-muted-foreground active:text-foreground"
                  >
                    <Settings className="h-5 w-5" aria-hidden />
                  </button>
                )
              }
            />
          )}
          {!native && !fullScreen && <MobileHintsBanner prompt={installPrompt} />}
          {/* D-14: the watermark sits behind the scroller; main stays the scroll container (MobileNeedsYou scrolls via closest('main')). */}
          <div className="relative min-h-0 flex-1">
            {!fullScreen && <LogoWatermark />}
            <main className="relative h-full overflow-y-auto">
              {route.tab === 'needs-you' ? (
                <MobileNeedsYou subjectId={route.subjectId} />
              ) : route.tab === 'conversations' ? (
                <MobileConversations
                  conversationId={route.conversationId}
                  onOpen={openConversation}
                  onBack={closeConversation}
                />
              ) : route.issueId ? (
                <MobileIssueSheet issueId={route.issueId} onBack={closeIssue} />
              ) : (
                <MobilePipeline onOpen={openIssue} />
              )}
            </main>
          </div>
          {!fullScreen && (
            <nav
              aria-label="Phone sections"
              className="flex shrink-0 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur"
            >
              {TABS.map(({ tab, label, icon: Icon }) => (
                <button
                  key={tab}
                  type="button"
                  aria-current={route.tab === tab ? 'page' : undefined}
                  onClick={() => navigateMobile({ tab, subjectId: null, conversationId: null, issueId: null })}
                  className={`flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
                    route.tab === tab ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {label}
                </button>
              ))}
            </nav>
          )}
          {!native && <MobileSettingsSheet open={settingsOpen} onClose={closeSettings} prompt={installPrompt} />}
        </>
      )}
      {/* PAN-5208 D-9: an overlay over the mounted app, never a gate. The phone app plays its own from ShellApp. */}
      {!native && <LogoSting ready={sessionAuthFailed || hasSnapshot} skip={initialDeepLink} />}
    </div>
  );
}
