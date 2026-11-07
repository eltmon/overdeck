/**
 * Phone app entry (PAN-4837 D-3). Static imports are hoisted, so only modules that never read
 * `__OVERDECK_NATIVE__` or capture `fetch` (the stylesheet, React DOM, the channel shims and the
 * session) are imported statically. The shims are installed before the shell, and through it every
 * frontend module, loads, so no module can capture the unshimmed `fetch` or `WebSocket` (H-3). The
 * request-failure observer (PAN-5100) is installed after the shims (and the optional request log)
 * and before the shell, so it wraps the shimmed `fetch` and sees every request the app makes.
 */
import '../../../src/dashboard/frontend/src/index.css';

import { installChannelShims } from '@overdeck/anywhere-channel/web';
import { createRoot } from 'react-dom/client';

import { installRequestLog } from './shell/requestLog';
import { currentMachine } from './shell/session';

(globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__ = true;

installChannelShims({ currentMachine });
if (import.meta.env.VITE_OVERDECK_REQUEST_LOG === '1') installRequestLog();

void import('../../../src/dashboard/frontend/src/lib/requestFailures')
  .then(({ installRequestFailureObserver }) => {
    installRequestFailureObserver({ client: 'phone' });
  })
  .catch(() => {
    // Telemetry must never block boot: continue without the observer.
  })
  .then(() => import('./shell/ShellApp'))
  .then(({ default: ShellApp }) => {
    createRoot(document.getElementById('root')!).render(<ShellApp />);
  });
