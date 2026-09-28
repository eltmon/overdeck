/**
 * A dialog step that shows the shared `ProjectCreateForm` for one mode, with
 * its own create-intent state (PAN-4281 WI-6).
 */

import { useProjectCreateIntent } from './useProjectCreateIntent.js';
import { ProjectCreateForm } from './ProjectCreateForm.js';
import type { CreatedProject, ProjectCreateMode } from './projectCreateTypes.js';

interface AddProjectFormStepProps {
  mode: ProjectCreateMode;
  titleId?: string;
  onCreated: (project: CreatedProject) => void;
  /** "Change": back to the start step. */
  onChange: () => void;
  onCancel: () => void;
}

export function AddProjectFormStep({ mode, titleId, onCreated, onChange, onCancel }: AddProjectFormStepProps) {
  const create = useProjectCreateIntent({ initialMode: mode, onCreated });
  return <ProjectCreateForm create={create} titleId={titleId} onChange={onChange} onCancel={onCancel} />;
}
