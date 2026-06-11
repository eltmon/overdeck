import type { ReactNode } from 'react';

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

export type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SettingsHeaderProps {
  title: string;
  /** Autosave status — every control persists on change; the header only reports. */
  status: SettingsSaveStatus;
  actions?: ReactNode;
}

export function SettingsHeader({ title, status, actions }: SettingsHeaderProps) {
  return (
    <div className="sticky top-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center justify-between px-6 py-3">
        <h1 className="text-foreground text-lg font-semibold tracking-tight">
          {title}
        </h1>
        <div className="flex items-center gap-3">
          {actions}
          {status === 'idle' && (
            <span className="text-muted-foreground/60 text-xs">Changes save automatically</span>
          )}
          {status === 'saving' && (
            <span className="text-muted-foreground text-xs font-medium">Saving…</span>
          )}
          {status === 'saved' && (
            <span className="text-success text-xs font-medium">Saved</span>
          )}
          {status === 'error' && (
            <span className="text-destructive text-xs font-medium">Save failed — your last change was not saved</span>
          )}
        </div>
      </div>
    </div>
  );
}
