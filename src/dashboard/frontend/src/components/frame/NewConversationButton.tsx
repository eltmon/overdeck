/**
 * NewConversationButton — the left column's split button (PAN-5293 F-D12).
 * The main part quick-creates a conversation in the selected project (an
 * unscoped one for No project or no project) with the newConversationDefaults
 * model, harness and effort, and opens it in the deck. The caret menu holds
 * the model, harness and effort pickers, the Retrospective button and
 * "New conversation with options…". It owns the `N` shortcut.
 *
 * PAN-5343 H-D13: in the All projects deck it creates in the last real
 * project, and the second line starts with that project's name.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useShortcut, type ShortcutDef } from '../../lib/shortcuts/registry';
import { ALL_PROJECTS_KEY, NO_PROJECT_LABEL } from '../CommandDeck/projectsData';
import { NewConversationPickers } from '../CommandDeck/NewConversationPickers';
import { openNewConversationDialog } from '../newConversation/newConversationDialogStore';
import { MenuOverlay, MenuSeparator, PopoverSurface } from '../shared/ContextMenu';
import { ProviderIcon } from '../shared/branding';
import { useAvailableModels } from '../shared/ModelPicker';
import { useCreateConversation } from './deck/useCreateConversation';
import { newConversationProjectKey } from '../../lib/lastProject';
import { useNewConversationDefaults } from './deck/newConversationDefaults';
import { newConversationSummary, newConversationTitle } from './newConversationSummary';

export interface NewConversationButtonProps {
  selectedProject: string | null;
  /** The collapsed column shows only a `+` icon. */
  collapsed: boolean;
}

export function NewConversationButton({ selectedProject, collapsed }: NewConversationButtonProps) {
  const [open, setOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);
  const { create } = useCreateConversation(selectedProject);
  const defaults = useNewConversationDefaults(useShallow((d) => ({
    model: d.model, harness: d.harness, effort: d.effort, setModel: d.setModel, setHarness: d.setHarness, setEffort: d.setEffort,
  })));
  const allProjects = selectedProject === ALL_PROJECTS_KEY;
  const projectKey = newConversationProjectKey(selectedProject);
  const { groups } = useAvailableModels();
  const summary = useMemo(
    () => newConversationSummary({ model: defaults.model, harness: defaults.harness, effort: defaults.effort, groups }),
    [defaults.model, defaults.harness, defaults.effort, groups],
  );
  const title = newConversationTitle(summary);

  const quickCreate = useCallback(() => {
    void create(projectKey);
  }, [create, projectKey]);

  useShortcut(useMemo((): ShortcutDef => ({
    id: 'deck.new-conversation', keys: { mac: 'N', other: 'N' }, scope: 'not-editing',
    label: 'New conversation', group: 'General', run: () => quickCreate(),
    when: () => !document.querySelector('[aria-modal="true"]'),
  }), [quickCreate]));

  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="new-conversation-button"
        onClick={quickCreate}
        title={title}
        aria-label="New conversation"
        className="list-row flex w-full items-center justify-center rounded-md py-2 text-body-foreground"
      >
        <Plus aria-hidden className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="relative flex items-stretch rounded-md border border-border">
      <button
        type="button"
        data-testid="new-conversation-button"
        onClick={quickCreate}
        title={title}
        aria-label="New conversation"
        className="list-row flex min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-l-md px-2 py-1.5 text-left text-sm font-medium text-foreground"
      >
        <span className="flex items-center gap-2">
          <Plus aria-hidden className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 truncate">New conversation</span>
          <span className="keycap rounded-md px-1.5 font-mono text-xs text-muted-foreground" aria-hidden>N</span>
        </span>
        <span data-testid="new-conversation-summary" className="flex min-w-0 items-center gap-1 pl-6 text-[11px] text-muted-foreground">
          {summary.provider && <ProviderIcon provider={summary.provider} label={summary.providerLabel} className="h-3 w-3 shrink-0" />}
          <span className="truncate">
            {[allProjects ? projectKey ?? NO_PROJECT_LABEL : null, summary.shortName, summary.harnessLabel, summary.effortLabel].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
      <button
        ref={caretRef}
        type="button"
        data-testid="new-conversation-caret"
        aria-label="New conversation options"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="list-row flex items-center rounded-r-md border-l border-border px-1.5 text-muted-foreground"
      >
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <MenuOverlay onClick={() => setOpen(false)} />
          <PopoverSurface
            aria-label="New conversation options"
            data-testid="new-conversation-menu"
            onClose={() => setOpen(false)}
            returnFocusRef={caretRef}
            className="absolute left-0 top-full z-[1000] mt-1 w-[280px]"
          >
            <p className="eyebrow px-2 pt-1 pb-1">Defaults for N</p>
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
              <NewConversationPickers
                model={defaults.model}
                onModelChange={defaults.setModel}
                harness={defaults.harness}
                onHarnessChange={defaults.setHarness}
                effort={defaults.effort}
                onEffortChange={defaults.setEffort}
              />
            </div>
            <MenuSeparator />
            <button
              type="button"
              role="menuitem"
              data-testid="new-conversation-with-options"
              onClick={() => {
                setOpen(false);
                openNewConversationDialog({ projectKey });
              }}
              className="list-row flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm font-medium text-body-foreground"
            >
              New conversation with options…
            </button>
          </PopoverSurface>
        </>
      )}
    </div>
  );
}
