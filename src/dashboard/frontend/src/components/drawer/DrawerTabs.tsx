import { cn } from '../../lib/utils';
import { useDashboardStore } from '../../lib/store';
import { useDrawerData } from './useDrawerData';

const DRAWER_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'plan', label: 'Plan' },
  { id: 'beads', label: 'Beads' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'activity', label: 'Activity' },
  { id: 'files', label: 'Files' },
] as const;

function beadCount(beads: ReturnType<typeof useDrawerData>['beads']) {
  if (beads.length === 0) return '0/0';
  const done = beads.filter((bead) => bead.status === 'done').length;
  return `${done}/${beads.length}`;
}

export default function DrawerTabs() {
  const activeTab = useDashboardStore((state) => state.drawer.tab);
  const setDrawerTab = useDashboardStore((state) => state.setDrawerTab);
  const { beads } = useDrawerData();

  return (
    <nav data-component="drawer-tabs" data-testid="drawer-tabs" className="border-b border-border bg-background/95 px-[14px]" role="tablist" aria-label="Issue drawer sections">
      <div className="flex min-w-0 items-center overflow-x-auto">
        {DRAWER_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`drawer-tab-${tab.id}`}
              className={cn(
                'relative flex shrink-0 items-center px-[14px] py-[10px] text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                active && 'text-foreground',
              )}
              onClick={() => setDrawerTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'beads' ? (
                <span data-testid="drawer-tab-beads-count" className="ml-[6px] rounded-full bg-primary/15 px-[5px] py-[1px] font-mono text-[10px] leading-none text-primary">
                  {beadCount(beads)}
                </span>
              ) : null}
              {active ? <span data-testid="drawer-tab-active-underline" className="absolute bottom-0 left-[14px] right-[14px] h-[2px] bg-primary" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
