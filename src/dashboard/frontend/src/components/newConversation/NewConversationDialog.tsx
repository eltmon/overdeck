/**
 * "New conversation with options" (PAN-4486): a modal for one launch's model,
 * harness, effort, context opt-outs, skills, linked issue and working
 * directory. Every choice applies to this conversation only: the dialog keeps
 * its own state and never writes the sidebar's stored model, harness, effort
 * or context choices (FR-5), so the next quick create is unchanged.
 *
 * After a create it opens the conversation through its `/conv/<id>` route
 * (D6); the Command Deck's deep-link effect selects it.
 */
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { EFFORT_LEVELS } from '@overdeck/contracts';
import { HarnessSelect, ModelSelect, pickerEffortLevels, useAvailableModels, type Harness } from '../shared/ModelPicker';
import { loadStoredHarness, loadStoredModel, MODEL_EFFORT_SUPPORT } from '../chat/ModelPicker';
import { fetchRegisteredProjects, type RegisteredProject } from '../CommandDeck/UnknownProjectState';
import { ConversationSkillsField } from './ConversationSkillsField';
import { IssuePickerField } from './IssuePickerField';
import { buildNewConversationPayload, createConversationWithOptions, fetchEffortDefault } from './newConversationApi';
import { useNewConversationDialogStore } from './newConversationDialogStore';
import styles from './NewConversationDialog.module.css';

/** D7: match the preset by yaml key, then by display name. */
function resolvePreset(projects: readonly RegisteredProject[], preset: string | undefined): RegisteredProject | undefined {
  if (!preset) return undefined;
  return projects.find((project) => project.key === preset) ?? projects.find((project) => project.name === preset);
}

function effortLevelsFor(model: string): readonly string[] {
  return pickerEffortLevels(model) ?? MODEL_EFFORT_SUPPORT[model as keyof typeof MODEL_EFFORT_SUPPORT] ?? EFFORT_LEVELS;
}

export function NewConversationDialogHost() {
  const open = useNewConversationDialogStore((s) => s.open);
  const projectKey = useNewConversationDialogStore((s) => s.projectKey);
  const close = useNewConversationDialogStore((s) => s.close);
  if (!open) return null;
  return <NewConversationDialog presetProject={projectKey} onClose={close} />;
}

export function NewConversationDialog({ presetProject, onClose }: { presetProject?: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const { groups, harnessPolicy } = useAvailableModels();
  const { data: projects, isFetched: projectsFetched } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });

  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [presetApplied, setPresetApplied] = useState(false);
  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState(() => loadStoredModel());
  const [harness, setHarness] = useState<Harness>(() => loadStoredHarness());
  const [effort, setEffort] = useState<string | null>(null);
  const [effortTouched, setEffortTouched] = useState(false);
  const [bareContext, setBareContext] = useState(false);
  const [skipClaudeMd, setSkipClaudeMd] = useState(false);
  const [skillOverrides, setSkillOverrides] = useState<Record<string, boolean>>({});
  const [issueId, setIssueId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = useMemo(() => projects?.find((p) => p.key === projectKey), [projects, projectKey]);

  useEffect(() => {
    if (presetApplied || !projectsFetched) return;
    const preset = resolvePreset(projects ?? [], presetProject);
    if (preset) {
      setProjectKey(preset.key);
      setCwd(preset.path);
    }
    setPresetApplied(true);
  }, [presetApplied, projectsFetched, projects, presetProject]);

  const effortLevels = effortLevelsFor(model);
  const effortSupported = effortLevels.length > 0;
  const { data: effortDefault } = useQuery({
    queryKey: ['new-conversation-effort-default', model, harness, issueId ?? ''],
    queryFn: () => fetchEffortDefault({ model, harness, issueId }),
    enabled: effortSupported,
  });

  // The resolved default applies until the operator picks an effort.
  useEffect(() => {
    if (effortTouched || !effortDefault) return;
    setEffort(effortDefault.effort);
  }, [effortTouched, effortDefault]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // A picked effort the new model does not support falls back to the default.
  const chooseModel = (next: string) => {
    setModel(next);
    if (effort && !effortLevelsFor(next).includes(effort)) {
      setEffortTouched(false);
      setEffort(null);
    }
  };

  const chooseProject = (key: string) => {
    const next = projects?.find((p) => p.key === key);
    setProjectKey(next ? next.key : null);
    setCwd(next?.path ?? '');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const conv = await createConversationWithOptions(buildNewConversationPayload({
        projectKey,
        projectPath: project?.path ?? null,
        cwd,
        model,
        harness,
        effort: effortSupported ? (effort ?? effortDefault?.effort ?? null) : null,
        bareContext,
        skipClaudeMd,
        skillOverrides,
        issueId,
        message,
      }));
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      window.history.pushState({}, '', `/conv/${conv.id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={() => { if (!submitting) onClose(); }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>New conversation with options</h2>
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose} disabled={submitting}>
            <X size={14} />
          </button>
        </div>

        <div className={styles.body}>
          <label className={styles.row}>
            <span className={styles.label}>Project</span>
            <select aria-label="Project" className={styles.control} value={projectKey ?? ''} onChange={(e) => chooseProject(e.target.value)}>
              <option value="">No project</option>
              {(projects ?? []).map((p) => (
                <option key={p.key} value={p.key}>{p.name ?? p.key}</option>
              ))}
            </select>
          </label>

          <label className={styles.row}>
            <span className={styles.label}>Working directory</span>
            <input
              aria-label="Working directory"
              className={styles.control}
              value={cwd}
              disabled={!projectKey}
              placeholder={projectKey ? '' : 'Default working directory'}
              onChange={(e) => setCwd(e.target.value)}
            />
          </label>

          <ModelSelect label="Model" value={model} onChange={chooseModel} groups={groups} />
          <HarnessSelect value={harness} onChange={setHarness} modelId={model} harnessPolicy={harnessPolicy} />

          <div className={styles.row}>
            <span className={styles.label}>Effort</span>
            {effortSupported ? (
              <div className={styles.effort}>
                <select
                  aria-label="Effort"
                  className={styles.control}
                  value={effort ?? ''}
                  onChange={(e) => { setEffort(e.target.value); setEffortTouched(true); }}
                >
                  {effort === null && <option value="">…</option>}
                  {effortLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
                {effortDefault && (
                  <span className={styles.hint}>
                    Default: {effortDefault.effort} ({effortDefault.source})
                    {effortDefault.clamped ? ` · clamped from ${effortDefault.requested}` : ''}
                  </span>
                )}
              </div>
            ) : (
              <span className={styles.hint}>Not supported by this model</span>
            )}
          </div>

          <fieldset className={styles.group}>
            <legend className={styles.label}>Context</legend>
            <label className={styles.check}>
              <input type="checkbox" checked={bareContext} onChange={(e) => setBareContext(e.target.checked)} />
              No context
            </label>
            <p className={styles.hint}>
              New conversations start without Overdeck context: no bundled rules, session briefing, memory injection or resume message. Faster to spawn.
            </p>
            {harness === 'claude-code' && (
              <>
                <label className={styles.check}>
                  <input type="checkbox" checked={skipClaudeMd} onChange={(e) => setSkipClaudeMd(e.target.checked)} />
                  Skip CLAUDE.md
                </label>
                <p className={styles.hint}>
                  Claude Code skips ~/.claude/CLAUDE.md, project CLAUDE.md files and auto memory (CLAUDE_CODE_DISABLE_CLAUDE_MDS).
                </p>
              </>
            )}
          </fieldset>

          <div className={styles.group}>
            <span className={styles.label}>Skills</span>
            <ConversationSkillsField
              projectKey={projectKey ?? undefined}
              issueId={issueId ?? undefined}
              value={skillOverrides}
              onChange={setSkillOverrides}
            />
          </div>

          <div className={styles.group}>
            <span className={styles.label}>Linked issue</span>
            <IssuePickerField value={issueId} onChange={setIssueId} />
          </div>

          <label className={styles.group}>
            <span className={styles.label}>First message</span>
            <textarea
              aria-label="First message"
              className={styles.textarea}
              rows={3}
              placeholder="Optional"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>

          {error && <p role="alert" className={styles.error}>{error}</p>}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.button} onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className={styles.primaryButton} aria-label="Create conversation" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
