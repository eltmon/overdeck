/**
 * PAN-4280 (WI-8, D4/D4a) — the Home composer's project chip. Shows which
 * project a conversation or terminal will start in and lets the user change
 * it, including "Add a project…", which opens the Add-project dialog over Home
 * (PAN-4281; it navigated to /projects/new before the dialog existed).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { RegisteredProject } from '../CommandDeck/UnknownProjectState';
import type { UiMode } from '../../lib/simple/uiMode';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { useAddProjectDialog } from '../project/new/addProjectDialogStore';

export interface HomeComposerProjectChipProps {
  mode: UiMode;
  projects: RegisteredProject[];
  value: string | undefined;
  onChange: (key: string | undefined) => void;
  disabled?: boolean;
}

export function HomeComposerProjectChip({ mode, projects, value, onChange, disabled }: HomeComposerProjectChipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  const selected = value ? projects.find((p) => p.key === value) : undefined;
  const noProjectLabel = mode === 'simple' ? SIMPLE_STRINGS.home.chipNoProject : 'No project (home folder)';
  const inPrefix = mode === 'simple' ? SIMPLE_STRINGS.home.chipIn : 'In: ';
  const addProjectLabel = mode === 'simple' ? SIMPLE_STRINGS.home.chipAddProject : 'Add a project…';
  const chipLabel = selected ? `${inPrefix}${selected.name ?? selected.key}` : noProjectLabel;

  const choose = (key: string | undefined) => {
    onChange(key);
    close();
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="h-11 max-w-[180px] truncate rounded-xl border border-input bg-card px-3 text-xs text-muted-foreground outline-none hover:bg-accent focus:border-ring disabled:opacity-50"
        data-testid="home-composer-project"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {chipLabel}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose a project"
          className="absolute bottom-full z-20 mb-1 max-h-64 min-w-[200px] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-floating"
        >
          {projects.map((project) => (
            <button
              key={project.key}
              type="button"
              role="menuitem"
              onClick={() => choose(project.key)}
              className="flex w-full cursor-pointer select-none items-center rounded px-3 py-1.5 text-left text-xs text-foreground outline-none hover:bg-accent"
            >
              {project.name ?? project.key}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(undefined)}
            className="flex w-full cursor-pointer select-none items-center rounded px-3 py-1.5 text-left text-xs text-foreground outline-none hover:bg-accent"
          >
            {noProjectLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              useAddProjectDialog.getState().show();
            }}
            className="flex w-full cursor-pointer select-none items-center rounded px-3 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-accent"
          >
            {addProjectLabel}
          </button>
        </div>
      )}
    </div>
  );
}
