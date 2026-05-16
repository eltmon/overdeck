import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface SettingsSectionProps {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  actions?: ReactNode;
}

export function SettingsSection({
  id,
  title,
  description,
  children,
  collapsible = false,
  defaultOpen = true,
  actions,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section id={id} className="py-6 first:pt-0 scroll-mt-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 text-left group"
              aria-expanded={open}
              aria-controls={`${id}-content`}
            >
              <h2 className="text-foreground text-base font-semibold tracking-tight">
                {title}
              </h2>
              <ChevronDown
                className={cn(
                  'w-4 h-4 text-muted-foreground transition-transform',
                  !open && '-rotate-90'
                )}
              />
            </button>
          ) : (
            <h2 className="text-foreground text-base font-semibold tracking-tight">
              {title}
            </h2>
          )}
          {description && (
            <span className="text-muted-foreground text-sm hidden sm:inline">
              — {description}
            </span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {(!collapsible || open) && (
        <div id={`${id}-content`} className="space-y-1">
          {children}
        </div>
      )}
    </section>
  );
}
