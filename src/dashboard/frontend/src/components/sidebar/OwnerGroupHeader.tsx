/** PAN-5153: the collapsible GitHub-owner header above a group of sidebar projects. */
import { ChevronDown, ChevronRight } from 'lucide-react';

interface OwnerGroupHeaderProps {
  owner: string | null;
  collapsed: boolean;
  /** The group is collapsed but holds the selected project. */
  holdsActive: boolean;
  onToggle: (owner: string | null) => void;
}

export function OwnerGroupHeader({ owner, collapsed, holdsActive, onToggle }: OwnerGroupHeaderProps) {
  return (
    <button
      type="button"
      data-testid={`sidebar-owner-${owner ?? 'other'}`}
      aria-expanded={!collapsed}
      onClick={() => onToggle(owner)}
      title={owner ?? 'Projects without a GitHub repository'}
      className={`w-full flex items-center gap-1.5 px-3 mt-2 mb-0.5 text-[10px] font-medium uppercase tracking-widest transition-colors hover:text-foreground ${collapsed && holdsActive ? 'text-foreground' : 'text-muted-foreground'}`}
    >
      {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      <span className="truncate">{owner ?? 'Other'}</span>
    </button>
  );
}
