import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

export interface SettingsLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
  header: ReactNode;
}

export function SettingsLayout({ sidebar, children, header }: SettingsLayoutProps) {
  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-48 shrink-0 border-r border-border overflow-y-auto py-4 px-2 hidden md:block">
          {sidebar}
        </aside>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[800px] mx-auto px-6 md:px-10 py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export interface SettingsHeaderProps {
  title: string;
  hasChanges: boolean;
  saving: boolean;
  saveSuccess: boolean;
  saveError: boolean;
  onSave: () => void;
  onReset: () => void;
  actions?: ReactNode;
}

export function SettingsHeader({
  title,
  hasChanges,
  saving,
  saveSuccess,
  saveError,
  onSave,
  onReset,
  actions,
}: SettingsHeaderProps) {
  return (
    <div className="sticky top-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center justify-between px-6 py-3">
        <h1 className="text-foreground text-lg font-semibold tracking-tight">
          {title}
        </h1>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-success text-xs font-medium">Saved</span>
          )}
          {saveError && (
            <span className="text-destructive text-xs font-medium">Save failed</span>
          )}
          {actions}
          <button
            type="button"
            onClick={onReset}
            disabled={!hasChanges}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              hasChanges
                ? 'text-muted-foreground hover:text-foreground'
                : 'text-muted-foreground/40 cursor-not-allowed'
            )}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!hasChanges || saving}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              hasChanges && !saving
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
