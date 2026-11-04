/**
 * Entry point of the hosted viewer bundle (PRD PAN-4481 WI-8; FR-12–FR-14, D-10, D-11, D-13).
 *
 * The `/s/:code` page carries `<body data-short-code>` and a hidden `#web-join` section. This
 * script unhides it, reads `GET /v1/web/session`, and on a **Join** click opens the web-join socket
 * (`BrowserJoin`) and answers the host's offer with the dashboard's `WebRtcViewer`. Joining is
 * always a click (D-11): only that click sets the per-tab `sessionStorage` marker that lets a
 * reload rejoin without a second click (FR-14). `documentElement.dataset.hostedJoin = "started"`
 * tells the page's localhost probe not to navigate away (D-10).
 */
import { WebRtcViewer, type ViewerNotice } from '../../../src/dashboard/frontend/src/components/chat/sharing/webrtc-viewer.ts';
import { BrowserJoin, type BrowserJoinState, type BrowserJoinView } from './join-socket.ts';
import { renderScreen, screenFor, type SessionState, type ViewerAction, type ViewerModel } from './view.ts';

const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/;
const LIVE: ReadonlySet<BrowserJoinState> = new Set(['connecting', 'lobby', 'admitted', 'host-disconnected']);
const TERMINAL: ReadonlySet<BrowserJoinState> = new Set(['left', 'kicked', 'revoked', 'ended', 'is-host', 'full', 'replaced', 'rejected']);

function sameNotice(a: ViewerNotice, b: ViewerNotice): boolean {
  return a.kind === b.kind && (a.kind !== 'hello_failed' || (b.kind === 'hello_failed' && a.code === b.code));
}

function readSession(body: unknown): SessionState {
  if (typeof body !== 'object' || body === null) return { signedIn: false };
  const raw = body as Record<string, unknown>;
  if (raw['signedIn'] === true && typeof raw['githubId'] === 'number' && typeof raw['login'] === 'string') {
    return { signedIn: true, githubId: raw['githubId'], login: raw['login'] };
  }
  return raw['reason'] === 'grant_expired' ? { signedIn: false, reason: 'grant_expired' } : { signedIn: false };
}

function start(): void {
  const code = document.body.dataset['shortCode'] ?? '';
  const root = document.getElementById('web-join');
  if (!CODE_RE.test(code) || !root) return;
  root.hidden = false;

  const marker = `overdeck-share-joined:${code}`;
  const readMarker = (): boolean => {
    try {
      return sessionStorage.getItem(marker) === '1';
    } catch {
      return false;
    }
  };
  const writeMarker = (on: boolean): void => {
    try {
      if (on) sessionStorage.setItem(marker, '1');
      else sessionStorage.removeItem(marker);
    } catch {
      // Storage blocked: a reload then shows Join again.
    }
  };

  const rejoinOnLoad = readMarker();
  // Set before the session check so the probe never navigates away during a reload rejoin.
  if (rejoinOnLoad) document.documentElement.dataset['hostedJoin'] = 'started';

  let model: ViewerModel = { session: 'checking', join: null, peerPhase: 'waiting', hasHistory: false, messages: [], presence: null, notices: [], code };
  let join: BrowserJoin | null = null;
  let viewer: WebRtcViewer | null = null;

  const update = (patch: Partial<ViewerModel>): void => {
    model = { ...model, ...patch };
    renderScreen(root, screenFor(model), { onAction });
  };

  const closeViewer = (): void => {
    viewer?.close();
    viewer = null;
  };

  const resetContent = (): void => {
    closeViewer();
    update({ peerPhase: 'waiting', hasHistory: false, messages: [], presence: null, notices: [] });
  };

  const ensureViewer = (): WebRtcViewer => {
    if (viewer) return viewer;
    const created = new WebRtcViewer(
      {
        sendSignal: async (data) => join?.sendSignal(data),
        fetchIceServers: () => (join ? join.fetchIceServers() : Promise.resolve([])),
      },
      {
        onMessages: (messages) => {
          if (viewer === created) update({ messages, hasHistory: true });
        },
        onPresence: (presence) => {
          if (viewer === created) update({ presence });
        },
        onPhase: (peerPhase) => {
          if (viewer === created) update({ peerPhase });
        },
        onNotice: (notice) => {
          if (viewer === created && !model.notices.some((n) => sameNotice(n, notice))) update({ notices: [...model.notices, notice] });
        },
        // The browser viewer has no terminal (PRD PAN-4481 NonGoals): it never calls setTerminalWatch,
        // so the host sends no terminal stream, and anything that arrives anyway is dropped.
        onTerminal: () => {},
      },
    );
    viewer = created;
    return created;
  };

  async function loadSession(): Promise<SessionState> {
    let session: SessionState;
    try {
      const res = await fetch('/v1/web/session', { credentials: 'same-origin' });
      session = res.ok ? readSession(await res.json()) : 'unavailable';
    } catch {
      session = 'unavailable';
    }
    update({ session });
    return session;
  }

  function onView(view: BrowserJoinView): void {
    if (!LIVE.has(view.state)) closeViewer();
    if (TERMINAL.has(view.state)) writeMarker(false);
    update({ join: view });
  }

  function startJoin(): void {
    document.documentElement.dataset['hostedJoin'] = 'started';
    writeMarker(true);
    join?.close();
    resetContent();
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://'; // ws: only for `wrangler dev --local`
    join = new BrowserJoin(
      {
        WebSocket,
        url: `${scheme}${location.host}/v1/rooms/${code}/web-join?v=1`,
        now: () => Date.now(),
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
      },
      {
        onView,
        onSignal: (data) => ensureViewer().onSignal(data),
        // D-13: a refused upgrade hides its status; the session says whether sign-in is the cause.
        onPreOpenFailure: () => void loadSession(),
      },
    );
    join.join();
  }

  function onAction(action: ViewerAction): void {
    if (action === 'join' || action === 'rejoin') startJoin();
    else if (action === 'leave') join?.leave();
    else if (action === 'reconnect') {
      resetContent();
      join?.reconnect();
    } else if (action === 'sign-out') writeMarker(false);
  }

  addEventListener('pagehide', () => {
    join?.close();
    closeViewer();
  });

  update({});
  void loadSession().then((session) => {
    if (rejoinOnLoad && typeof session === 'object' && session.signedIn && join === null) startJoin();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
