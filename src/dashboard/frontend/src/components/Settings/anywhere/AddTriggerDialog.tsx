/**
 * Add a webhook trigger (PAN-4648 FR-8). The form creates a trigger through
 * `POST /api/triggers`; on success it switches to a result view that shows the
 * full Funnel URL (or the hook path under a placeholder host) and any
 * generated GitHub signing secret. That view is the only time either is shown:
 * closing the dialog (Done, the close button, Escape or a scrim click) unmounts
 * it, and the URL with it. `SetSigningSecretDialog` sets the secret of
 * a github or stripe trigger through `PUT /api/triggers/:id/signing-secret`.
 *
 * PAN-2356: when the overdeck.ai directory is connected on the Anywhere plan, the form offers to
 * hold events in a directory inbox while this machine is offline; the result then shows the inbox
 * URL, once, instead of the Funnel URL.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { fetchRegisteredProjects } from '../../CommandDeck/UnknownProjectState';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
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

interface DialogFrameProps {
  title: string;
  onClose: () => void;
  /** Makes the panel a form whose submit button sits in `footer`. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** Error alert that stays visible above the footer. */
  pinned?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

function DialogFrame({ title, onClose, onSubmit, pinned, footer, children }: DialogFrameProps) {
  return (
    <Modal title={title} size="narrow" onClose={onClose} onSubmit={onSubmit} pinned={pinned} footer={footer}>
      {children}
    </Modal>
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
    <div className={formStyles.field}>
      <p className={formStyles.label}>{label}</p>
      <div className="flex items-start gap-2">
        <code data-testid={testId} className="min-w-0 flex-1 break-all select-all rounded-md border border-border bg-muted/30 px-2 py-1.5 font-mono text-xs text-foreground">
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copyText(value)}
          className={`${formStyles.button} shrink-0`}
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
      <DialogFrame
        title="Trigger created"
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose} className={formStyles.primaryButton}>
            Done
          </button>
        }
      >
        <div className={`${formStyles.content} space-y-4`}>
          {created.inboxUrl ? (
            <>
              <CopyField label="Inbox URL" value={created.inboxUrl} testId="trigger-created-inbox-url" />
              <p className={formStyles.hint}>
                overdeck.ai holds each event, sealed to this machine, for up to 24 hours while it is offline.
              </p>
            </>
          ) : (
            <CopyField label="URL" value={url} testId="trigger-created-url" />
          )}
          {!created.inboxUrl && created.url === null && (
            <p className={formStyles.hint}>
              Replace the placeholder host with this machine&apos;s Tailscale name once Funnel is on.
            </p>
          )}
          {created.generatedSigningSecret && (
            <CopyField label="Signing secret" value={created.generatedSigningSecret} testId="trigger-created-signing-secret" />
          )}
          <p className={formStyles.text}>This URL is shown once. Save it now.</p>
        </div>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      title="Add trigger"
      onClose={onClose}
      onSubmit={(e) => void handleSubmit(e)}
      pinned={error ? <p role="alert" className={formStyles.error}>{error}</p> : null}
      footer={
        <>
          <button type="button" onClick={onClose} className={formStyles.button}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className={formStyles.primaryButton}>
            Create trigger
          </button>
        </>
      }
    >
      <div className={formStyles.form}>
        <label className={formStyles.field}>
          <span className={formStyles.label}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-failures" className={formStyles.input} />
        </label>

        <fieldset className={formStyles.fieldset}>
          <legend className={`${formStyles.label} mb-2.5`}>Target</legend>
          <div className="flex gap-4">
            <label className={formStyles.choice}>
              <input type="radio" name="trigger-target" checked={targetKind === 'conversation'} onChange={() => setTargetKind('conversation')} />
              <span className={formStyles.choiceTitle}>Conversation</span>
            </label>
            <label className={formStyles.choice}>
              <input type="radio" name="trigger-target" checked={targetKind === 'project'} onChange={() => setTargetKind('project')} />
              <span className={formStyles.choiceTitle}>Project</span>
            </label>
          </div>
        </fieldset>

        {targetKind === 'conversation' ? (
          <label className={formStyles.field}>
            <span className={formStyles.label}>Conversation (name or id)</span>
            <input value={conversation} onChange={(e) => setConversation(e.target.value)} placeholder="20261101-0001" className={`${formStyles.input} ${formStyles.mono}`} />
          </label>
        ) : (
          <label className={formStyles.field}>
            <span className={formStyles.label}>Project</span>
            <select value={projectKey} onChange={(e) => setProjectKey(e.target.value)} className={formStyles.select}>
              <option value="">Choose a project</option>
              {(projects ?? []).map((project) => (
                <option key={project.key} value={project.key}>{project.name ?? project.key}</option>
              ))}
            </select>
          </label>
        )}

        <label className={formStyles.field}>
          <span className={formStyles.label}>
            Prompt template{targetKind === 'project' ? '' : ' (optional)'}
          </span>
          <textarea
            value={template}
            maxLength={TEMPLATE_MAX_CHARS}
            onChange={(e) => setTemplate(e.target.value)}
            rows={3}
            className={formStyles.textarea}
          />
          <span className={`${formStyles.hint} text-right`}>{template.length}/{TEMPLATE_MAX_CHARS}</span>
        </label>

        <label className={formStyles.field}>
          <span className={formStyles.label}>Verification</span>
          <select value={verify} onChange={(e) => setVerify(e.target.value as TriggerRow['verify'])} className={formStyles.select}>
            <option value="none">None</option>
            <option value="github">GitHub signature</option>
            <option value="stripe">Stripe signature</option>
          </select>
        </label>

        {verify !== 'none' && (
          <label className={formStyles.field}>
            <span className={formStyles.label}>
              Signing secret (optional{verify === 'github' ? '; one is generated when empty' : ''})
            </span>
            <input type="password" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} autoComplete="off" className={`${formStyles.input} ${formStyles.mono}`} />
          </label>
        )}

        {canUseInbox && (
          <label className={formStyles.choice}>
            <input type="checkbox" checked={inbox} onChange={(e) => setInbox(e.target.checked)} />
            <span className={formStyles.choiceTitle}>Hold events while this machine is offline (overdeck.ai inbox, Anywhere plan)</span>
          </label>
        )}
      </div>
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
    <DialogFrame
      title={`Set signing secret for ${trigger.name}`}
      onClose={onClose}
      onSubmit={(e) => void handleSubmit(e)}
      pinned={error ? <p role="alert" className={formStyles.error}>{error}</p> : null}
      footer={
        <>
          <button type="button" onClick={onClose} className={formStyles.button}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={formStyles.primaryButton}>
            Save secret
          </button>
        </>
      }
    >
      <div className={formStyles.form}>
        <label className={formStyles.field}>
          <span className={formStyles.label}>
            {trigger.verify === 'stripe' ? 'Stripe endpoint secret (whsec_…)' : 'GitHub webhook secret'}
          </span>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" className={`${formStyles.input} ${formStyles.mono}`} />
        </label>
      </div>
    </DialogFrame>
  );
}
