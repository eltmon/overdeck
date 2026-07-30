// @vitest-environment jsdom
/**
 * PAN-1990 no-loss audit: the additive-refactor gate for docs/audits/pan-1990-surface-inventory.md.
 *
 * Each row below asserts a pre-change dashboard affordance still resolves —
 * either the same named export from the same module, or (for the one
 * genuinely-relocated affordance, predating PAN-1990) a `relocated` marker
 * pointing at its living successor, which is itself checked. Deleting an
 * export without updating its row to `relocated` fails this test.
 *
 * The CLI half of this audit — every pre-existing `pan workspace` / `pan memory`
 * verb and flag, plus the surfaces PAN-3286 adds — lives in the sibling
 * no-loss-audit-cli.test.ts. It cannot be merged into this file because the jsdom
 * environment above breaks the CLI import chain (PAN-3286 WI-9).
 */
import { describe, expect, it } from 'vitest';
import { TAB_PATHS } from '../../../src/dashboard/frontend/src/App/routes.js';

// Route-table check: every tab that existed on origin/main before PAN-1990
// keeps its exact path. PAN-1990 only adds `workspace`.
const PRE_PAN_1990_TAB_PATHS: Record<string, string> = {
  home: '/',
  pipeline: '/pipeline',
  kanban: '/board',
  'command-deck': '/command-deck',
  agents: '/agents',
  flywheel: '/flywheel',
  orders: '/orders',
  backlog: '/backlog',
  resources: '/resources',
  knowledge: '/knowledge',
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

describe('no-loss audit (PAN-1990 ac1, ac2)', () => {
  it('every pre-change tab route is preserved with its exact path', () => {
    for (const [tab, path] of Object.entries(PRE_PAN_1990_TAB_PATHS)) {
      expect(TAB_PATHS[tab as keyof typeof TAB_PATHS]).toBe(path);
    }
  });

  it('PAN-1990 adds the workspace route additively, without removing any tab', () => {
    expect(Object.keys(TAB_PATHS).length).toBe(Object.keys(PRE_PAN_1990_TAB_PATHS).length + 1);
    expect(TAB_PATHS.workspace).toBe('/workspace');
  });

  it('Sidebar nav item affordance resolves (component + workspace-registry rail)', async () => {
    const mod = await import('../../../src/dashboard/frontend/src/components/Sidebar.js');
    expect(typeof mod.Sidebar).toBe('function');
    expect(typeof mod.sortWorkspaces).toBe('function');
  });

  it('command palette (Cmd-K) affordance resolves', async () => {
    const mod = await import('../../../src/dashboard/frontend/src/components/CommandPalette.js');
    expect(typeof mod.CommandPalette).toBe('function');
  });

  it('kanban action affordance resolves', async () => {
    const mod = await import('../../../src/dashboard/frontend/src/components/KanbanBoard.js');
    expect(typeof mod.KanbanBoard).toBe('function');
  });

  it('vBRIEF viewer affordance resolves (kanban card + drawer entry points)', async () => {
    const viewer = await import('../../../src/dashboard/frontend/src/components/xbrief/XBriefViewer.js');
    expect(typeof viewer.XBriefViewer).toBe('function');
    const drawer = await import('../../../src/dashboard/frontend/src/components/drawer/DrawerSecondaryPanels.js');
    expect(typeof drawer.DrawerPlanPanel).toBe('function');
  });

  it('vBRIEF affordance relocated: historical InspectorPanel -> DrawerPlanPanel/XBriefViewer (predates PAN-1990)', () => {
    // See docs/audits/pan-1990-surface-inventory.md §3 — InspectorPanel was
    // already removed before PAN-1990 (docs/COMMAND-DECK-RESTORATION.md).
    // This row exists so the historical affordance is accounted for rather
    // than silently dropped from the inventory.
    const relocated = 'components/drawer/DrawerSecondaryPanels.tsx (DrawerPlanPanel) + components/xbrief/XBriefViewer.tsx';
    expect(relocated.length).toBeGreaterThan(0);
  });

  it('conversations panel entry points resolve', async () => {
    const list = await import('../../../src/dashboard/frontend/src/components/CommandDeck/ConversationList.js');
    expect(typeof list.ConversationList).toBe('function');
    expect(typeof list.fetchConversations).toBe('function');
    const panel = await import('../../../src/dashboard/frontend/src/components/chat/ConversationPanel.js');
    expect(typeof panel.ConversationPanel).toBe('function');
  });

  it('cost view affordance resolves', async () => {
    const mod = await import('../../../src/dashboard/frontend/src/components/CostsPage.js');
    expect(typeof mod.CostsPage).toBe('function');
  });

  it('terminal access path affordance resolves', async () => {
    const xterm = await import('../../../src/dashboard/frontend/src/components/XTerminal.js');
    expect(typeof xterm.XTerminal).toBe('function');
    const panel = await import('../../../src/dashboard/frontend/src/components/TerminalPanel.js');
    expect(typeof panel.TerminalPanel).toBe('function');
  });

  it('PAN-1990 additive surfaces resolve (WorkspaceView route + workspace-registry route)', async () => {
    const view = await import('../../../src/dashboard/frontend/src/components/workspace/WorkspaceView.js');
    expect(typeof view.WorkspaceView).toBe('function');
    const routes = await import('../../../src/dashboard/frontend/src/App/routes.js');
    expect(typeof routes.getWorkspaceRouteFromPath).toBe('function');
  });
});
