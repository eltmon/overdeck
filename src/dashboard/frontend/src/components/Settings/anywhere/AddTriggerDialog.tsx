/**
 * Add a webhook trigger (PAN-4648 FR-8). The form creates a trigger through
 * `POST /api/triggers`; on success it switches to a result view that shows the
 * full Funnel URL (or the hook path under a placeholder host) and any
 * generated GitHub signing secret. That view is the only time either is shown:
 * closing the dialog unmounts it, so a backdrop click does not close it; only
 * Done or the close button does. `SetSigningSecretDialog` sets the secret of
 * a github or stripe trigger through `PUT /api/triggers/:id/signing-secret`.
 *
 * PAN-2356: when the overdeck.ai directory is connected on the Anywhere plan, the form offers to
 * hold events in a directory inbox while this machine is offline; the result then shows the inbox
 * URL, once, instead of the Funnel URL.
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import { fetchRegisteredProjects } from '../../CommandDeck/UnknownProjectState';
import {
  ANYWHERE_TRIGGERS_QUERY_KEY,
  apiError,
  createTrigger,
  isOk,
  setTriggerSigningSecret,
  type CreatedTriggerBody,
  type TriggerRow,
} from './anywhereApi';
import { DIRECTORY_QUERY_KEY, inboxAvailable, loadDirectory } from './directoryApi';

const TEMPLATE_MAX_CHARS = 2000;
const FUNNEL_PLACEHOLDER_BASE = 'https://<machine>.<tailnet>.ts.net:8443';
const fieldClass = 'w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary';

interface DialogFrameProps {
  title: string;
  titleId: string;
  onClose: () => void;
  /** False keeps a backdrop click from closing the dialog (the one-time URL view). */
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

function DialogFrame({ title, titleId, onClose, closeOnBackdrop = true, children }: DialogFrameProps) {
  return (
    <div
      data-testid="trigger-dialog-backdrop"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id={titleId} className="text-base font-medium text-foreground">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4 text-sm">{children}</div>
      </div>
    </div>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
  } catch (err) {
    toast.error(`Could not copy: ${(err as Error).message}`);
  }
}

function CopyField({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2">
        <code data-testid={testId} className="min-w-0 flex-1 break-all select-all rounded-md border border-border bg-muted/30 px-2 py-1.5 font-mono text-xs text-foreground">
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copyText(value)}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/40 transition-colors"
        >
          Copy {label.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

interface AddTriggerDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddTriggerDialog({ open, onClose }: AddTriggerDialogProps) {
  if (!open) return null;
  return <AddTriggerDialogBody onClose={onClose} />;
}

function AddTriggerDialogBody({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const { data: projects } = useQuery({ queryKey: ['registered-projects'], queryFn: fetchRegisteredProjects, staleTime: 60000 });
  const { data: directory } = useQuery({ queryKey: DIRECTORY_QUERY_KEY, queryFn: loadDirectory, staleTime: 30000, retry: false });
  const canUseInbox = inboxAvailable(directory);

  const [name, setName] = useState('');
  const [targetKind, setTargetKind] = useState<'conversation' | 'project'>('conversation');
  const [conversation, setConversation] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [template, setTemplate] = useState('');
  const [verify, setVerify] = useState<TriggerRow['verify']>('none');
  const [signingSecret, setSigningSecret] = useState('');
  const [inbox, setInbox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedTriggerBody | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (targetKind === 'conversation' && !conversation.trim()) return setError('Enter a conversation name or id.');
    if (targetKind === 'project' && !projectKey) return setError('Choose a project.');
    if (targetKind === 'project' && !template.trim()) return setError('A project trigger needs a prompt template.');
    setSubmitting(true);
    try {
      const result = await createTrigger({
        name: name.trim(),
        target: targetKind === 'conversation' ? { kind: 'conversation', conversation: conversation.trim() } : { kind: 'project', projectKey },
        template: template === '' ? null : template,
        verify,
        signingSecret: signingSecret === '' ? null : signingSecret,
        ...(canUseInbox && inbox ? { inbox: true } : {}),
      });
      if (!isOk(result)) {
        setError(apiError(result));
        return;
      }
      setCreated(result.body);
      await queryClient.invalidateQueries({ queryKey: ANYWHERE_TRIGGERS_QUERY_KEY });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    const url = created.url ?? `${FUNNEL_PLACEHOLDER_BASE}${created.hookPath}`;
    return (
      <DialogFrame title="Trigger created" titleId={titleId} onClose={onClose} closeOnBackdrop={false}>
        {created.inboxUrl ? (
          <>
            <CopyField label="Inbox URL" value={created.inboxUrl} testId="trigger-created-inbox-url" />
            <p className="text-xs text-muted-foreground">
              overdeck.ai holds each event, sealed to this machine, for up to 24 hours while it is offline.
            </p>
          </>
        ) : (
          <CopyField label="URL" value={url} testId="trigger-created-url" />
        )}
        {!created.inboxUrl && created.url === null && (
          <p className="text-xs text-muted-foreground">
            Replace the placeholder host with this machine&apos;s Tailscale name once Funnel is on.
          </p>
        )}
        {created.generatedSigningSecret && (
          <CopyField label="Signing secret" value={created.generatedSigningSecret} testId="trigger-created-signing-secret" />
        )}
        <p className="text-xs text-foreground">This URL is shown once. Save it now.</p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors">
            Done
          </button>
        </div>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame title="Add trigger" titleId={titleId} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3" noValidate>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-failures" className={fieldClass} />
        </label>

        <fieldset className="space-y-1">
          <legend className="text-xs text-muted-foreground">Target</legend>
          <div className="flex gap-4 text-xs text-foreground">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="trigger-target" checked={targetKind === 'conversation'} onChange={() => setTargetKind('conversation')} />
              Conversation
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="trigger-target" checked={targetKind === 'project'} onChange={() => setTargetKind('project')} />
              Project
            </label>
          </div>
        </fieldset>

        {targetKind === 'conversation' ? (
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Conversation (name or id)</span>
            <input value={conversation} onChange={(e) => setConversation(e.target.value)} placeholder="20261101-0001" className={`${fieldClass} font-mono`} />
          </label>
        ) : (
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Project</span>
            <select value={projectKey} onChange={(e) => setProjectKey(e.target.value)} className={fieldClass}>
              <option value="">Choose a project</option>
              {(projects ?? []).map((project) => (
                <option key={project.key} value={project.key}>{project.name ?? project.key}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">
            Prompt template{targetKind === 'project' ? '' : ' (optional)'}
          </span>
          <textarea
            value={template}
            maxLength={TEMPLATE_MAX_CHARS}
            onChange={(e) => setTemplate(e.target.value)}
            rows={3}
            className={fieldClass}
          />
          <span className="block text-right text-xs text-muted-foreground">{template.length}/{TEMPLATE_MAX_CHARS}</span>
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Verification</span>
          <select value={verify} onChange={(e) => setVerify(e.target.value as TriggerRow['verify'])} className={fieldClass}>
            <option value="none">None</option>
            <option value="github">GitHub signature</option>
            <option value="stripe">Stripe signature</option>
          </select>
        </label>

        {verify !== 'none' && (
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              Signing secret (optional{verify === 'github' ? '; one is generated when empty' : ''})
            </span>
            <input type="password" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} autoComplete="off" className={`${fieldClass} font-mono`} />
          </label>
        )}

        {canUseInbox && (
          <label className="flex items-start gap-1.5 text-xs text-foreground">
            <input type="checkbox" checked={inbox} onChange={(e) => setInbox(e.target.checked)} className="mt-0.5" />
            Hold events while this machine is offline (overdeck.ai inbox, Anywhere plan)
          </label>
        )}

        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/40 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            Create trigger
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

interface SetSigningSecretDialogProps {
  trigger: TriggerRow | null;
  onClose: () => void;
}

export function SetSigningSecretDialog({ trigger, onClose }: SetSigningSecretDialogProps) {
  if (!trigger) return null;
  return <SetSigningSecretDialogBody trigger={trigger} onClose={onClose} />;
}

function SetSigningSecretDialogBody({ trigger, onClose }: { trigger: TriggerRow; onClose: () => void }) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!secret.trim()) return setError('Enter the signing secret.');
    setSaving(true);
    setError(null);
    try {
      const result = await setTriggerSigningSecret(trigger.id, secret.trim());
      if (!isOk(result)) {
        setError(apiError(result));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ANYWHERE_TRIGGERS_QUERY_KEY });
      toast.success('Signing secret set');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogFrame title={`Set signing secret for ${trigger.name}`} titleId={titleId} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3" noValidate>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">
            {trigger.verify === 'stripe' ? 'Stripe endpoint secret (whsec_…)' : 'GitHub webhook secret'}
          </span>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" className={`${fieldClass} font-mono`} />
        </label>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/40 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            Save secret
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
