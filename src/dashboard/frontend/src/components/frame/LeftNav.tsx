/**
 * LeftNav — the left column's navigation (PAN-5293 F-D11): Project home,
 * Flywheel (with "running" while a run is going), Order books, and a More ▾
 * menu holding every other view (MORE_GROUPS). Home (`/`) is the top-bar
 * brand. Experimental views appear only when the setting is on.
 */

import { forwardRef, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, BookOpen, Home, MoreHorizontal, type LucideIcon } from 'lucide-react';
import type { Tab } from '../Header';
import { fetchExperimentalFeaturesEnabled, isExperimentalTab } from '../../lib/experimentalFeatures';
import { useFlywheelRunning } from '../../lib/flywheelApi';
import { selectActivePane, usePanesStore } from '../../lib/panesStore';
import { MenuItemButton, MenuOverlay, MenuSurface } from '../shared/ContextMenu';
import { MORE_GROUPS } from './navGroups';

export interface LeftNavProps {
  activeTab: Tab;
  selectedProject: string | null;
  onTabChange: (tab: Tab) => void;
  /** Open the selected project's deck on its Home pane. */
  onOpenProjectHome: () => void;
  /** The collapsed column shows icons only. */
  collapsed: boolean;
}

interface NavButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  testId: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}

const NavButton = forwardRef<HTMLButtonElement, NavButtonProps>(function NavButton(
  { testId, label, icon: Icon, active, collapsed, onClick, trailing, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      data-testid={testId}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`list-row flex w-full items-center gap-2.5 rounded-md text-sm font-medium ${collapsed ? 'justify-center py-2' : 'px-2 py-1.5'} ${active ? 'bg-accent text-foreground' : 'text-body-foreground'}`}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && trailing}
    </button>
  );
});

export function LeftNav({ activeTab, selectedProject, onTabChange, onOpenProjectHome, collapsed }: LeftNavProps) {
  const flywheelRunning = useFlywheelRunning();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const { data: experimentalFeaturesEnabled = false } = useQuery({
    queryKey: ['settings', 'experimental-features'],
    queryFn: fetchExperimentalFeaturesEnabled,
    staleTime: 30_000,
  });
  const visibleMoreGroups = useMemo(
    () => MORE_GROUPS
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => experimentalFeaturesEnabled || !isExperimentalTab(item.id)),
      }))
      .filter((group) => group.items.length > 0),
    [experimentalFeaturesEnabled],
  );
  const activePane = usePanesStore(selectActivePane(selectedProject ?? ''));
  const homeActive = activeTab === 'command-deck' && (activePane === null || activePane.paneType === 'home');
  const moreActive = activeTab !== 'settings'
    && visibleMoreGroups.some((group) => group.items.some((item) => item.id === activeTab));

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5" data-testid="left-nav">
      {selectedProject && (
        <NavButton
          testId="left-nav-project-home"
          label="Project home"
          icon={Home}
          active={homeActive}
          collapsed={collapsed}
          onClick={onOpenProjectHome}
        />
      )}
      <NavButton
        testId="sidebar-flywheel"
        label="Flywheel"
        icon={Activity}
        active={activeTab === 'flywheel'}
        collapsed={collapsed}
        onClick={() => onTabChange('flywheel')}
        trailing={flywheelRunning
          ? <span className="ml-auto text-[11px] text-muted-foreground" data-testid="sidebar-flywheel-live">running</span>
          : undefined}
      />
      <NavButton
        testId="sidebar-orders"
        label="Order books"
        icon={BookOpen}
        active={activeTab === 'orders'}
        collapsed={collapsed}
        onClick={() => onTabChange('orders')}
      />
      <div className="relative">
        <NavButton
          ref={moreRef}
          testId="left-nav-more"
          label="More"
          icon={MoreHorizontal}
          active={moreActive}
          collapsed={collapsed}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          trailing={<span aria-hidden className="ml-auto text-[11px] text-muted-foreground">▾</span>}
        />
        {moreOpen && (
          <>
            <MenuOverlay onClick={() => setMoreOpen(false)} />
            <MenuSurface
              aria-label="More views"
              data-testid="left-nav-more-menu"
              onClose={() => setMoreOpen(false)}
              returnFocusRef={moreRef}
              className={`absolute z-[1000] w-[220px] max-h-[70vh] overflow-y-auto ${collapsed ? 'left-full top-0 ml-1' : 'left-0 top-full mt-1'}`}
            >
              {visibleMoreGroups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label} data-testid={`left-nav-group-${group.label}`}>
                  <p className="eyebrow px-2 pt-2 pb-1">{group.label}</p>
                  {group.items.map(({ id, label, icon: Icon }) => (
                    <MenuItemButton
                      key={id}
                      data-testid={`sidebar-${id}`}
                      active={activeTab === id}
                      onClick={() => { setMoreOpen(false); onTabChange(id); }}
                    >
                      <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                      {label}
                    </MenuItemButton>
                  ))}
                </div>
              ))}
            </MenuSurface>
          </>
        )}
      </div>
    </nav>
  );
}
