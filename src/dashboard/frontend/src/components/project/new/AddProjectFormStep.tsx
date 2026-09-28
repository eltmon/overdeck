/**
 * A dialog step that shows the shared `ProjectCreateForm` for one mode, with
 * its own create-intent state (PAN-4281 WI-6).
 */

import { useEffect } from 'react';
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
  /** True while an operation is live (e.g. a clone), so the dialog keeps itself open. */
  onBusyChange?: (busy: boolean) => void;
}

export function AddProjectFormStep({ mode, titleId, onCreated, onChange, onCancel, onBusyChange }: AddProjectFormStepProps) {
  const create = useProjectCreateIntent({ initialMode: mode, onCreated });
  useEffect(() => {
    onBusyChange?.(create.frozen);
    return () => onBusyChange?.(false);
  }, [create.frozen, onBusyChange]);
  return <ProjectCreateForm create={create} titleId={titleId} onChange={onChange} onCancel={onCancel} />;
}
