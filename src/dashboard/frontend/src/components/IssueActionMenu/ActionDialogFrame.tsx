import type { ReactNode } from 'react';

import { Modal } from '../shared/Modal';

/**
 * The modal shell every issue-action dialog renders inside.
 *
 * It lives in its own module rather than in IssueActionMenu.tsx so that a dialog
 * in its own file can use it without importing the menu that renders the dialog
 * — that import pair is a cycle, and `npm run lint:circular` rejects it
 * (PAN-4198, added with RestartAgentDialog).
 */
export type ActionDialogFrameProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
};

export function ActionDialogFrame({ label, onClose, children }: ActionDialogFrameProps) {
  return <Modal title={label} size="narrow" onClose={onClose}>{children}</Modal>;
}
