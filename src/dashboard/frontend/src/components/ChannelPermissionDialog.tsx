import { Loader2, ShieldAlert } from 'lucide-react'
import type { ChannelPermissionRequestSnapshot } from '@panctl/contracts'

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-warning/30 bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="rounded-full bg-warning/15 p-2">
            <ShieldAlert className="h-5 w-5 text-warning-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Tool Permission Required</h2>
            <p className="text-sm text-muted-foreground">
              Claude is waiting for an operator decision before it can continue.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
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
            This decision applies only to this pending Claude permission prompt. Panopticon can currently send
            only allow or deny for channel permissions.
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-card/40 px-5 py-4">
          <button
            type="button"
            onClick={onDeny}
            disabled={isSubmitting}
            className="rounded-md border border-border bg-popover px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={onAllow}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-md bg-warning px-4 py-2 text-sm font-semibold text-warning-foreground transition-colors hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
