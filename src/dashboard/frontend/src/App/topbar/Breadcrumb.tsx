// The top bar's crumb (PAN-5292 WI-E8, FR-E7, E-D16).
//
// On the Command Deck it reads "<project name> / <active Stage pane label>";
// with no project selected it reads "All projects"; on the No-project deck it
// reads "No project / <pane label>". Every other route shows its page title.
// PAN-5343 H-D4: the All projects deck reads "All projects / <pane label>",
// or "All projects / N conversations side by side" while N ≥ 2 panes show.
// The project name comes from the registered project (`overdeck`), never its
// key (`panopticon-cli`).

import type { Tab } from '../../components/Header';
import { ALL_PROJECTS_KEY, ALL_PROJECTS_LABEL, NO_PROJECT_KEY } from '../../components/CommandDeck/projectsData';
import { selectDeckLayout, useDeckLayoutStore } from '../../lib/deckLayoutStore';
import { leafCount } from '../../lib/paneLayout';
import { useRootLabel } from '../../components/explorer/rootForConversation';
import { selectActivePane, usePanesStore } from '../../lib/panesStore';
import { projectCrumbLabel, TAB_TITLES } from '../appChromeLabels';

const CRUMB_CLASS = 'flex min-w-0 shrink items-center gap-1.5 text-sm';

function DeckCrumb({ projectKey }: { projectKey: string }) {
  const isNoProject = projectKey === NO_PROJECT_KEY;
  const projectName = useRootLabel(isNoProject ? null : `project:${projectKey}`);
  const paneLabel = usePanesStore(selectActivePane(projectKey))?.label ?? 'Home';
  return (
    <div className={CRUMB_CLASS} data-testid="topbar-crumb">
      <span className="shrink-0 font-medium text-foreground">
        {isNoProject ? projectCrumbLabel(projectKey) : projectName ?? projectKey}
      </span>
      <span className="shrink-0 text-muted-foreground" aria-hidden="true">/</span>
      <span className="min-w-0 truncate text-muted-foreground">{paneLabel}</span>
    </div>
  );
}

function AllProjectsCrumb() {
  const layout = useDeckLayoutStore(selectDeckLayout(ALL_PROJECTS_KEY));
  const paneLabel = usePanesStore(selectActivePane(ALL_PROJECTS_KEY))?.label;
  const shown = layout ? leafCount(layout) : 0;
  const detail = shown >= 2 ? `${shown} conversations side by side` : paneLabel ?? 'Conversation';
  return (
    <div className={CRUMB_CLASS} data-testid="topbar-crumb">
      <span className="shrink-0 font-medium text-foreground">{ALL_PROJECTS_LABEL}</span>
      <span className="shrink-0 text-muted-foreground" aria-hidden="true">/</span>
      <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
    </div>
  );
}

export function Breadcrumb({ activeTab, selectedProjectKey }: { activeTab: Tab; selectedProjectKey: string | null }) {
  if (activeTab === 'command-deck') {
    if (selectedProjectKey === ALL_PROJECTS_KEY) return <AllProjectsCrumb />;
    if (selectedProjectKey) return <DeckCrumb projectKey={selectedProjectKey} />;
    return (
      <div className={CRUMB_CLASS} data-testid="topbar-crumb">
        <span className="text-muted-foreground">All projects</span>
      </div>
    );
  }
  return (
    <div className={CRUMB_CLASS} data-testid="topbar-crumb">
      <span className="truncate font-medium text-foreground">{TAB_TITLES[activeTab]}</span>
    </div>
  );
}
