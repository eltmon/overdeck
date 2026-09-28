/**
 * The Add-project dialog (PAN-4281 D11): one component that renders as a modal
 * over the app, or as the full `/projects/new` page.
 *
 * Steps: `start` chooses how to add the project; `clone`, `create` and `folder`
 * each show the shared `ProjectCreateForm` in that mode. Every create goes
 * through `POST /api/projects/resolve` then `POST /api/projects`, the one
 * create core.
 */

import { useCallback, useId, useState } from 'react';
import { AddProjectStartStep } from './AddProjectStartStep.js';
import { AddProjectFormStep } from './AddProjectFormStep.js';
import { useAddProjectDialog, type AddProjectMode } from './addProjectDialogStore.js';
import type { CreatedProject } from './projectCreateTypes.js';

type Step = 'start' | 'clone' | 'create' | 'folder';

const STEP_FOR_MODE: Record<AddProjectMode, Step> = { clone: 'clone', new: 'create', existing: 'folder' };
const MODE_FOR_STEP = { clone: 'clone', create: 'new', folder: 'existing' } as const;

interface AddProjectDialogProps {
  variant: 'modal' | 'page';
  initialMode?: AddProjectMode;
  onCreated: (project: CreatedProject) => void;
  onCancel: () => void;
}

export function AddProjectDialog({ variant, initialMode, onCreated, onCancel }: AddProjectDialogProps) {
  const [step, setStep] = useState<Step>(initialMode ? STEP_FOR_MODE[initialMode] : 'start');
  const titleId = useId();
  const backToStart = useCallback(() => setStep('start'), []);

  const body =
    step === 'start' ? (
      <AddProjectStartStep
        titleId={titleId}
        showGuide={variant === 'page'}
        onChoose={(mode) => setStep(STEP_FOR_MODE[mode])}
        onCancel={onCancel}
      />
    ) : (
      <AddProjectFormStep
        key={step}
        mode={MODE_FOR_STEP[step]}
        titleId={titleId}
        onCreated={onCreated}
        onChange={backToStart}
        onCancel={onCancel}
      />
    );

  if (variant === 'page') {
    return <div className="h-full w-full overflow-y-auto bg-background">{body}</div>;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto pt-[8vh]">
      <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className="relative mx-4 mb-8 w-full max-w-[42rem] rounded border border-border bg-background shadow-2xl"
      >
        {body}
      </div>
    </div>
  );
}

/** The app-wide modal host: renders the dialog while the store says it is open. */
export function AddProjectDialogHost({ onCreated }: { onCreated: (project: CreatedProject) => void }) {
  const open = useAddProjectDialog((state) => state.open);
  const mode = useAddProjectDialog((state) => state.mode);
  const hide = useAddProjectDialog((state) => state.hide);
  if (!open) return null;
  return (
    <AddProjectDialog
      variant="modal"
      initialMode={mode}
      onCancel={hide}
      onCreated={(project) => {
        // Before hide(): the created handler reads the pending returnTo.
        onCreated(project);
        hide();
      }}
    />
  );
}
