import type { ViewMode as ConversationViewMode } from '../components/chat/ConversationPanel';
import type { Tab } from '../components/Header';

export const TAB_PATHS: Record<Tab, string> = {
  home: '/',
  pipeline: '/pipeline',
  kanban: '/board',
  'command-deck': '/command-deck',
  agents: '/agents',
  flywheel: '/flywheel',
  backlog: '/backlog',
  resources: '/resources',
  autopreso: '/autopreso',
  activity: '/activity',
  metrics: '/metrics',
  costs: '/costs',
  skills: '/skills',
  context: '/context',
  health: '/health',
  settings: '/settings',
  'god-view': '/god-view',
  deacon: '/deacon',
  sessions: '/sessions',
  'awaiting-merge': '/awaiting-merge',
};

const PATH_TO_TAB: Record<string, Tab> = {
  ...Object.fromEntries(
    Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab])
  ) as Record<string, Tab>,
};

function getTabFromPath(): Tab {
  const path = window.location.pathname;
  if (path.startsWith('/conv/')) return 'command-deck';
  // Cockpit deep-link: /command-deck/<project>/<issue> (PAN-2005). The bare
  // /command-deck is matched by PATH_TO_TAB below; the nested form needs the prefix.
  if (path.startsWith('/command-deck/')) return 'command-deck';
  return PATH_TO_TAB[path] || 'home';
}

/**
 * Parse a cockpit deep-link `/command-deck/<project>/<issue>` into its parts, or
 * null when the path is not a cockpit route. Lets a reload/bookmark/back-button
 * restore the exact issue cockpit tab (panes are otherwise localStorage-only).
 */
export function getCockpitRouteFromPath(path = window.location.pathname): { project: string; issue: string } | null {
  const m = path.match(/^\/command-deck\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  return { project: dec(m[1] ?? ''), issue: dec(m[2] ?? '') };
}

/**
 * Parse a project-home deep-link `/command-deck/<project>`. The issue cockpit
 * route is handled separately by getCockpitRouteFromPath.
 */
export function getCommandDeckProjectRouteFromPath(path = window.location.pathname): string | null {
  const m = path.match(/^\/command-deck\/([^/]+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1] ?? '');
  } catch {
    return m[1] ?? null;
  }
}

export function getConversationViewModeFromSearch(search = window.location.search): ConversationViewMode {
  const view = new URLSearchParams(search).get('view');
  return view === 'terminal' ? 'terminal' : 'conversation';
}

export type ConversationViewModeMap = Record<string, ConversationViewMode>;

export function parseConversationViewModes(search = window.location.search): ConversationViewModeMap {
  const raw = new URLSearchParams(search).get('views');
  if (!raw) return {};

  return raw
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .reduce<ConversationViewModeMap>((acc, entry) => {
      const [id, mode] = entry.split(':');
      if (!id) return acc;
      acc[id] = mode === 'terminal' ? 'terminal' : 'conversation';
      return acc;
    }, {});
}

export function serializeConversationViewModes(viewModes: ConversationViewModeMap): string {
  return Object.entries(viewModes)
    .filter(([, mode]) => mode === 'terminal')
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, mode]) => `${id}:${mode}`)
    .join(',');
}

export function normalizeLegacyAwaitingMergeRoute(_path = window.location.pathname, _search = window.location.search): string | null {
  // Awaiting Merge is its own dedicated page again — no redirect to /pipeline.
  // Kept as a stub so existing imports/tests still resolve.
  return null;
}

export function normalizeCurrentRoute() {
  // No legacy route normalization needed currently — Awaiting Merge is a
  // first-class page at /awaiting-merge again.
}

/** Extract conversation route key from /conv/:key path, or null if not matching. */
export function getConvIdFromPath(path = window.location.pathname): string | null {
  const match = path.match(/^\/conv\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return match[1] ?? null;
  }
}

export function getConversationRouteState() {
  const convId = getConvIdFromPath();
  const viewModes = parseConversationViewModes();
  const explicitViewMode = getConversationViewModeFromSearch();
  const viewMode = convId
    ? explicitViewMode === 'terminal'
      ? 'terminal'
      : viewModes[convId] ?? 'conversation'
    : 'conversation';

  if (convId && explicitViewMode === 'terminal') {
    viewModes[convId] = 'terminal';
  }

  return {
    tab: getTabFromPath(),
    convId,
    viewMode,
    viewModes,
  };
}

export function buildConversationUrl(
  id: string | null,
  viewMode: ConversationViewMode = 'conversation',
  viewModes: ConversationViewModeMap = {},
): string {
  if (!id) return '/command-deck';
  const nextViewModes = { ...viewModes };
  if (viewMode === 'terminal') {
    nextViewModes[id] = 'terminal';
  } else {
    delete nextViewModes[id];
  }

  const params = new URLSearchParams();
  if (viewMode === 'terminal') {
    params.set('view', 'terminal');
  }
  const serialized = serializeConversationViewModes(nextViewModes);
  if (serialized) {
    params.set('views', serialized);
  }
  const query = params.toString();
  return query ? `/conv/${id}?${query}` : `/conv/${id}`;
}
