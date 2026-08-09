import { useState } from 'react';
import { NewProjectModal } from '../components/CommandDeck/NewProjectModal.js';
import { useWorkspaceCreateIntent } from '../components/workspace/new/useWorkspaceCreateIntent.js';
import { getNewWorkspaceProjectFromSearch } from '../App/routes.js';

export function NewWorkspacePage() {
  const [projectPreset] = useState(() => getNewWorkspaceProjectFromSearch() ?? '');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const intent = useWorkspaceCreateIntent({ initialProjectKey: projectPreset });

  return (
    <div data-testid="new-workspace-page" className="h-full w-full overflow-y-auto bg-background">
      <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-12 lg:px-12 lg:py-16">
        <div
          data-testid="new-workspace-project-chip-row"
          data-region="project-chip-row"
          data-selected-project={intent.projectKey}
          className="mb-8 min-h-9"
        />

        <input
          data-testid="new-workspace-hero-title"
          data-region="hero-title"
          aria-label="Workspace name"
          className="display-xl mb-7 w-full border-0 bg-transparent p-0 text-foreground caret-primary outline-none placeholder:text-muted-foreground/40"
          value={intent.name}
          onChange={(event) => intent.setName(event.target.value)}
          placeholder="Untitled workspace"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />

        <div data-testid="new-workspace-target-row" data-region="target-row" className="mb-10 min-h-9" />
        <div data-testid="new-workspace-hairline-top" data-region="hairline-top" className="mb-5 border-t border-border" />
        <div data-testid="new-workspace-status-strip" data-region="status-strip" className="mb-5 min-h-12" />
        <div data-testid="new-workspace-hairline-bottom" data-region="hairline-bottom" className="mb-8 border-t border-border" />
        <div data-testid="new-workspace-idea-grid" data-region="idea-grid" className="min-h-48 flex-1" />
      </main>

      <NewProjectModal
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={(project) => {
          intent.setProjectKey(project.key);
          setNewProjectOpen(false);
        }}
      />
    </div>
  );
}
