import { cn } from '../../../lib/utils';

export interface NavItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface SettingsSidebarNavProps {
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function SettingsSidebarNav({ items, activeId, onSelect }: SettingsSidebarNavProps) {
  return (
    <nav aria-label="Settings sections" className="space-y-0.5">
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
              isActive
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
            aria-current={isActive ? 'true' : undefined}
          >
            {item.icon && <item.icon className="w-4 h-4 shrink-0" />}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
