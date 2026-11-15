/**
 * The top bar's "Needs you · N" button and menu (PAN-5292 WI-E2, FR-E3, E-D18).
 *
 * N is `useNeedsYouItems().length` — the one needs-you list every surface
 * shares (PAN-5287 D-8), so the top bar and the Home page agree. The button is
 * always present: "Needs you · 0" renders neutral, and amber appears only when
 * something is waiting. The menu groups the items by project and each row opens
 * its own subject through `item.open()` (Flywheel items open the Flywheel page
 * themselves).
 *
 * This is aggregate chrome (docs/DASHBOARD-ARCHITECTURE.md "Render discipline
 * (PAN-4560)"): it must stay a leaf and never move into AppChrome or App.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useNeedsYouItems, type NeedsYouItem } from '../../lib/selectors/needsYou';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { useNow } from '../../hooks/useNow';
import { fetchRegisteredProjects } from '../CommandDeck/UnknownProjectState';
import { MenuItemButton, MenuSeparator, MenuSurface } from '../shared/ContextMenu';

const OTHER_GROUP = 'Other';

interface ItemGroup {
  name: string;
  items: NeedsYouItem[];
}

function groupByProject(items: readonly NeedsYouItem[], projectName: ReadonlyMap<string, string>): ItemGroup[] {
  const groups = new Map<string, NeedsYouItem[]>();
  for (const item of items) {
    const name = item.projectKey ? projectName.get(item.projectKey) ?? item.projectKey : OTHER_GROUP;
    const group = groups.get(name);
    if (group) group.push(item);
    else groups.set(name, [item]);
  }
  const named = [...groups].filter(([name]) => name !== OTHER_GROUP);
  const other = groups.get(OTHER_GROUP);
  return [...named, ...(other ? [[OTHER_GROUP, other] as const] : [])].map(([name, groupItems]) => ({
    name,
    items: groupItems,
  }));
}

/** PAN-5293 F-D23: "<ask> · waiting <relative>" when the item knows since when it waits. */
function NeedsYouRowSubline({ item }: { item: NeedsYouItem }) {
  const now = useNow(60_000);
  const waiting = item.since ? formatRelativeTime(item.since, now) : '';
  return (
    <span className="block truncate text-[11.5px] text-muted-foreground" data-testid="needs-you-row-subline">
      {item.ask}
      {waiting && ` · waiting ${waiting}`}
    </span>
  );
}

function navigateToActivity(): void {
  if (window.location.pathname !== '/activity') window.history.pushState({}, '', '/activity');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function NeedsYouIndicator() {
  const items = useNeedsYouItems();
  const { data: projects } = useQuery({ queryKey: ['registered-projects'], queryFn: fetchRegisteredProjects });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const groups = useMemo(() => {
    const projectName = new Map((Array.isArray(projects) ? projects : []).map((p) => [p.key, p.name || p.key]));
    return groupByProject(items, projectName);
  }, [items, projects]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = items.length;
  const tone = count > 0
    ? 'badge-border-state-needs-you badge-bg-state-needs-you'
    : 'border-border bg-card';

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${count} thing${count === 1 ? '' : 's'} need you`}
        data-testid="flywheel-needs-you-indicator"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-7 items-center gap-[7px] whitespace-nowrap rounded-md border px-2.5 text-[12.5px] text-foreground transition-colors hover:bg-accent ${tone}`}
      >
        <span
          data-testid="needs-you-dot"
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${count > 0 ? 'bg-state-needs-you' : 'bg-state-waiting'}`}
        />
        Needs you · {count}
      </button>
      {open && (
        <MenuSurface
          aria-label="Needs you"
          data-testid="needs-you-menu"
          onClose={() => setOpen(false)}
          returnFocusRef={triggerRef}
          className="absolute right-0 top-full z-50 mt-1.5 w-[380px]"
        >
          <div className="eyebrow px-2 pb-1 pt-1.5">Needs you · all projects</div>
          {count === 0 ? (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">Nothing needs you right now.</div>
          ) : (
            groups.map((group) => (
              <div key={group.name} role="group" aria-label={group.name} data-testid="needs-you-group">
                <div className="px-3 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">{group.name}</div>
                {group.items.map((item) => (
                  <MenuItemButton
                    key={item.key}
                    data-testid="needs-you-row"
                    onClick={() => {
                      setOpen(false);
                      item.open();
                    }}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-state-needs-you" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.title}</span>
                      <NeedsYouRowSubline item={item} />
                    </span>
                  </MenuItemButton>
                ))}
              </div>
            ))
          )}
          <MenuSeparator />
          <MenuItemButton
            onClick={() => {
              setOpen(false);
              navigateToActivity();
            }}
          >
            Open Activity
          </MenuItemButton>
        </MenuSurface>
      )}
    </div>
  );
}
