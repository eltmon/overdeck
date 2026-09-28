/**
 * PAN-4280 (WI-17, D11, FR-12) — "Not in a project · Move to project…" chip
 * shown above an unscoped conversation's pane. Self-gates: renders nothing
 * unless the conversation is unscoped and at least one project is
 * registered, so it never appears for a project-scoped conversation or when
 * there is nothing to move it to.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { Conversation } from './ConversationList';
import { fetchRegisteredProjects } from './UnknownProjectState';
import { isUnscopedConversation } from './projectsData';
import { useConversationMutations } from './useConversationMutations';

export interface UnscopedConversationChipProps {
  conversation: Conversation;
}

export function UnscopedConversationChip({ conversation }: UnscopedConversationChipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mutations = useConversationMutations(null, () => {});

  const projectsQuery = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60_000,
  });
  const projects = projectsQuery.data ?? [];

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

  if (projects.length === 0 || !isUnscopedConversation(conversation, projects)) return null;

  return (
    <div ref={wrapperRef} className="relative flex shrink-0 items-center border-b border-border/80 bg-card px-3 py-1.5">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground outline-none hover:text-foreground"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Not in a project · <span className="underline underline-offset-2">Move to project…</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Move to project"
          className="absolute left-3 top-full z-20 mt-1 max-h-64 min-w-[200px] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-floating"
        >
          {projects.map((project) => (
            <button
              key={project.key}
              type="button"
              role="menuitem"
              onClick={() => {
                mutations.move({ name: conversation.name, projectKey: project.key, projectName: project.name ?? project.key });
                close();
              }}
              className="flex w-full cursor-pointer select-none items-center rounded px-3 py-1.5 text-left text-xs text-foreground outline-none hover:bg-accent"
            >
              {project.name ?? project.key}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
