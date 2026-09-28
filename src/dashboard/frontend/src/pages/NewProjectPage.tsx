/**
 * `/projects/new` — add a project by cloning, opening a folder, or starting one
 * (PAN-3836 WI-4).
 *
 * The page is the Add-project dialog rendered full-page (PAN-4281 D11): the same
 * steps the modal shows, so a deep link or `?mode=` preset keeps working. With
 * no preset it opens on the start step; `?mode=` skips straight to that mode.
 */

import { getNewProjectModeFromSearch } from '../App/routes.js';
import { AddProjectDialog } from '../components/project/new/AddProjectDialog.js';
import type { CreatedProject } from '../components/project/new/projectCreateTypes.js';

interface NewProjectPageProps {
  onCancel: () => void;
  onCreated: (project: CreatedProject) => void;
}

export function NewProjectPage({ onCancel, onCreated }: NewProjectPageProps) {
  // Hand-rolled routing: the dashboard mounts no <Router>, so the preset comes
  // from window.location the way the workspace page reads it (D-14).
  return (
    <AddProjectDialog
      variant="page"
      initialMode={getNewProjectModeFromSearch() ?? undefined}
      onCreated={onCreated}
      onCancel={onCancel}
    />
  );
}
