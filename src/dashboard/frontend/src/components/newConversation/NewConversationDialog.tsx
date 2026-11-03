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
import { ChevronDown, Folder } from 'lucide-react';
import { toast } from 'sonner';
import { EFFORT_LEVELS } from '@overdeck/contracts';
import { cn } from '../../lib/utils';
import { Modal } from '../shared/Modal';
import { HARNESS_OPTIONS, HarnessSelect, ModelSelect, pickerEffortLevels, useAvailableModels, type Harness } from '../shared/ModelPicker';
import { loadStoredHarness, loadStoredModel, MODEL_EFFORT_SUPPORT } from '../chat/ModelPicker';
import { fetchRegisteredProjects, type RegisteredProject } from '../CommandDeck/UnknownProjectState';
import { buildConversationUrl } from '../../App/routes';
import { ConversationSkillsField, summarizeSkills, useConversationSkillGroups } from './ConversationSkillsField';
import { IssuePickerField } from './IssuePickerField';
import { buildNewConversationPayload, createConversationWithOptions, createFleetConversation, fetchEffortDefault } from './newConversationApi';
import { useNewConversationDialogStore } from './newConversationDialogStore';
import { MachineField, type MachineChoice, parseNeedsInput, THIS_MACHINE, useMachineCwdHint } from './MachineField';
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
  const [machine, setMachine] = useState<MachineChoice>(THIS_MACHINE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const whereHeadingId = useId();
  const agentHeadingId = useId();
  const taskHeadingId = useId();
  const contextHeadingId = useId();
  const skillsHeadingId = useId();
  const projectId = useId();
  const cwdId = useId();
  const modelLabelId = useId();
  const harnessLabelId = useId();
  const effortLabelId = useId();
  const issueLabelId = useId();
  const messageId = useId();
  const bareLabelId = useId();
  const bareDescId = useId();
  const skipMdLabelId = useId();
  const skipMdDescId = useId();
  const skillsPanelId = useId();

  const project = useMemo(() => projects?.find((p) => p.key === projectKey), [projects, projectKey]);
  const cwdHint = useMachineCwdHint(machine, project ? (project.name ?? project.key) : null);

  const skillsQuery = useConversationSkillGroups(projectKey ?? undefined, issueId ?? undefined);
  const [skillsOpen, setSkillsOpen] = useState(() => Object.keys(skillOverrides).length > 0);
  const skillsSummary = skillsQuery.data ? summarizeSkills(skillsQuery.data, skillOverrides) : null;

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
    // PAN-4743: Fly (new VM) needs a project; clearing it resets the choice to this machine.
    if (!next && machine.machine === 'fly') setMachine(THIS_MACHINE);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = buildNewConversationPayload({
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
      });
      // PAN-4651 D-4651-23: another machine, or Auto, goes through the fleet route.
      let route: string;
      if (machine.machine === '') {
        route = `/conv/${(await createConversationWithOptions(payload)).id}`;
      } else {
        const created = await createFleetConversation(payload, machine.machine, parseNeedsInput(machine.needs));
        if (created.reason) toast(created.reason);
        route = buildConversationUrl(created.conversation);
      }
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      window.history.pushState({}, '', route);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const harnessLabel = HARNESS_OPTIONS.find((h) => h.id === harness)?.label ?? harness;
  const footerSummary = [
    model,
    harnessLabel,
    ...(effortSupported ? [effort ?? effortDefault?.effort ?? '…'] : []),
    projectKey ?? 'No project',
  ].join(' · ');

  return (
    <Modal
      title="New conversation"
      description="These choices apply to this conversation only. Your sidebar defaults stay the same."
      onClose={onClose}
      dismissible={!submitting}
      onSubmit={submit}
      pinned={error
        ? <p role="alert" className={styles.error}>{error}</p>
        : (submitting && machine.machine === 'fly' ? <p role="status" className={styles.summary}>Starting a Fly machine. This takes a few minutes.</p> : null)}
      footer={<>
        <p className={styles.summary} data-component="new-conversation-summary">{footerSummary}</p>
        <button type="button" className={styles.button} onClick={onClose} disabled={submitting}>Cancel</button>
        <button type="submit" className={styles.primaryButton} aria-label="Create conversation" disabled={submitting}>
          {submitting ? (machine.machine === 'fly' ? 'Starting…' : 'Creating…') : 'Create'}
        </button>
      </>}
    >
      <section className={styles.section} aria-labelledby={whereHeadingId}>
        <h3 id={whereHeadingId} className={styles.sectionTitle}>Where it runs</h3>
        <div className={styles.grid}>
          <label htmlFor={projectId} className={styles.label}>Project</label>
          <div className={styles.field}>
            <select
              id={projectId}
              className={styles.select}
              value={projectKey ?? ''}
              onChange={(e) => chooseProject(e.target.value)}
            >
              <option value="">No project</option>
              {(projects ?? []).map((p) => (
                <option key={p.key} value={p.key}>{p.name ?? p.key}</option>
              ))}
            </select>
            <ChevronDown size={14} className={styles.chev} />
          </div>

          <MachineField value={machine} onChange={setMachine} hasProject={projectKey !== null} />

          <label htmlFor={cwdId} className={styles.label}>Working directory</label>
          <div className={styles.field}>
            <span className={styles.lead} aria-hidden="true"><Folder size={14} /></span>
            <input
              id={cwdId}
              className={cn(styles.input, styles.mono)}
              spellCheck={false}
              value={cwdHint === null ? cwd : ''}
              disabled={!projectKey || cwdHint !== null}
              placeholder={cwdHint ?? (projectKey ? '' : 'Default working directory')}
              title={cwdHint ?? undefined}
              onChange={(e) => setCwd(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={agentHeadingId}>
        <h3 id={agentHeadingId} className={styles.sectionTitle}>Agent</h3>
        <div className={styles.grid}>
          <span id={modelLabelId} className={styles.label}>Model</span>
          <ModelSelect labelId={modelLabelId} label="Model" value={model} onChange={chooseModel} groups={groups} />

          <span id={harnessLabelId} className={styles.label}>Harness</span>
          <HarnessSelect labelId={harnessLabelId} value={harness} onChange={setHarness} modelId={model} harnessPolicy={harnessPolicy} />

          <span id={effortLabelId} className={styles.label}>Effort</span>
          {effortSupported ? (
            <div className={styles.effortRow}>
              <div role="radiogroup" aria-labelledby={effortLabelId} className={styles.segmented}>
                {effortLevels.map((level) => {
                  const isDefault = effortDefault?.effort === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={effort === level}
                      data-default={isDefault ? 'true' : undefined}
                      className={styles.segment}
                      onClick={() => { setEffort(level); setEffortTouched(true); }}
                    >
                      {level}
                      {isDefault && <span className={styles.defaultDot} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
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
      </section>

      <section className={styles.section} aria-labelledby={taskHeadingId}>
        <h3 id={taskHeadingId} className={styles.sectionTitle}>Task<span className={styles.aside}>Both optional</span></h3>
        <div className={styles.grid}>
          <span id={issueLabelId} className={styles.label}>Linked issue</span>
          <IssuePickerField value={issueId} onChange={setIssueId} labelId={issueLabelId} />

          <label htmlFor={messageId} className={cn(styles.label, styles.full)}>First message</label>
          <textarea
            id={messageId}
            className={cn(styles.textarea, styles.full)}
            rows={3}
            placeholder="Sent as soon as the conversation starts"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby={contextHeadingId}>
        <h3 id={contextHeadingId} className={styles.sectionTitle}>Context</h3>
        <div className={styles.option}>
          <span className={styles.optionLabel}><span id={bareLabelId}>No context</span></span>
          <button
            type="button"
            role="switch"
            aria-checked={bareContext}
            aria-labelledby={bareLabelId}
            aria-describedby={bareDescId}
            className={styles.switch}
            onClick={() => setBareContext((v) => !v)}
          />
          <p id={bareDescId} className={styles.optionDescription}>
            New conversations start without Overdeck context: no bundled rules, session briefing, memory injection or resume message. Faster to spawn.
          </p>
        </div>
        {harness === 'claude-code' && (
          <div className={styles.option}>
            <span className={styles.optionLabel}>
              <span id={skipMdLabelId}>Skip CLAUDE.md</span>
              <span className={styles.tag}>Claude Code</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={skipClaudeMd}
              aria-labelledby={skipMdLabelId}
              aria-describedby={skipMdDescId}
              className={styles.switch}
              onClick={() => setSkipClaudeMd((v) => !v)}
            />
            <p id={skipMdDescId} className={styles.optionDescription}>
              Claude Code skips <code>~/.claude/CLAUDE.md</code>, project CLAUDE.md files and auto memory (<code>CLAUDE_CODE_DISABLE_CLAUDE_MDS</code>).
            </p>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby={skillsHeadingId}>
        <h3 id={skillsHeadingId} className={styles.sectionTitle}>Skills</h3>
        <div className={styles.skillsSummary}>
          <p className={styles.skillsText}>
            {skillsSummary === null ? (skillsQuery.isError ? 'Skills unavailable' : 'Loading skills…') : <>
              {skillsSummary.on} of {skillsSummary.total} skills on{' '}
              <span className={styles.skillsAside}>
                {skillsSummary.overrides === 0
                  ? '· inherited from project and global settings, no overrides'
                  : `· ${skillsSummary.overrides} ${skillsSummary.overrides === 1 ? 'override' : 'overrides'} in this conversation`}
              </span>
            </>}
          </p>
          {(skillsSummary !== null || skillsQuery.isError) && (
            <button
              type="button"
              className={styles.linkButton}
              aria-expanded={skillsOpen}
              aria-controls={skillsPanelId}
              onClick={() => setSkillsOpen((v) => !v)}
            >
              {skillsOpen ? 'Done' : 'Customize'}
            </button>
          )}
        </div>
        <div id={skillsPanelId} className={styles.skillsPanel} hidden={!skillsOpen}>
          <ConversationSkillsField
            projectKey={projectKey ?? undefined}
            issueId={issueId ?? undefined}
            value={skillOverrides}
            onChange={setSkillOverrides}
          />
        </div>
      </section>
    </Modal>
  );
}
