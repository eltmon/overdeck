import { Loader2 } from 'lucide-react'
import type { ChannelPermissionRequestSnapshot } from '@overdeck/contracts'

import { Modal } from './shared/Modal'
import formStyles from './shared/ModalForm.module.css'

interface ChannelPermissionDialogProps {
  request: ChannelPermissionRequestSnapshot | null
  isOpen: boolean
  issueId?: string
  isSubmitting?: boolean
  onAllow: () => void
  onDeny: () => void
}

export function ChannelPermissionDialog({
  request,
  isOpen,
  issueId,
  isSubmitting = false,
  onAllow,
  onDeny,
}: ChannelPermissionDialogProps) {
  if (!isOpen || !request) return null

  return (
    <Modal
      title="Tool Permission Required"
      description="Claude is waiting for an operator decision before it can continue."
      onClose={onDeny}
      dismissible={false}
      footer={
        <>
          <button type="button" onClick={onDeny} disabled={isSubmitting} className={formStyles.button}>
            Deny
          </button>
          <button type="button" onClick={onAllow} disabled={isSubmitting} className={formStyles.primaryButton}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Allow
          </button>
        </>
      }
    >
      <div className={`${formStyles.content} flex flex-col gap-4`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent</p>
            <p className="font-mono text-sm text-foreground">{request.agentId}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Issue</p>
            <p className="font-mono text-sm text-foreground">{issueId ?? 'Unknown'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tool</p>
            <p className="text-sm font-medium text-foreground">{request.toolName}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requested at</p>
            <p className="text-sm text-foreground">{new Date(request.createdAt).toLocaleString()}</p>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground">
            {request.description}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arguments</p>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-background/80 p-3 text-xs text-foreground whitespace-pre-wrap break-words">
            {request.inputPreview || 'No input preview provided.'}
          </pre>
        </div>

        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          This decision applies only to this pending Claude permission prompt. Overdeck can currently send
          only allow or deny for channel permissions.
        </div>
      </div>
    </Modal>
  )
}
