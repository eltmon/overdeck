/**
 * Skill packs (PAN-4334) inside the skill overrides panel, at all three levels.
 *
 * A pack row turns the whole pack on or off; expanding it shows each pack
 * skill (`pack/skill`) with its own control. Pack skills are off unless a
 * pack toggle or a per-skill value turns them on, and opt-in skills ignore
 * the pack toggle. At global both controls are two-state switches; at
 * project and issue they are Inherit | On | Off. Adding a pack needs the
 * CLI's consent flow, so the dashboard only shows the command.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { cn } from '../../lib/utils';

// Declared here rather than imported: SkillOverridesPanel imports this module.
type SkillOverrideLevel = 'global' | 'project' | 'issue';
/** Same key as SkillOverridesPanel's SKILL_OVERRIDES_QUERY_KEY, so a save refreshes the panel. */
const SKILL_OVERRIDES_QUERY_KEY = ['skill-overrides'] as const;
type ToggleSource = SkillOverrideLevel | 'default';
type PackSkillSource = SkillOverrideLevel | 'issue-pack' | 'project-pack' | 'global-pack' | 'default';

export interface PackSkillState {
  id: string;
  name: string;
  description: string;
  optIn: boolean;
  bundledOverlap: boolean;
  global: boolean | null;
  project: boolean | null;
  issue: boolean | null;
  enabled: boolean;
  source: PackSkillSource;
  inherited: { enabled: boolean; source: PackSkillSource };
}

export interface PackState {
  id: string;
  url: string;
  ref: string;
  commit: string;
  adapter: string;
  license: string | null;
  cached: boolean;
  notApplied: string[];
  duplicatePluginInstall: boolean;
  updateAvailable?: string | null;
  global: boolean | null;
  project: boolean | null;
  issue: boolean | null;
  enabled: boolean;
  source: ToggleSource;
  inherited: { enabled: boolean; source: ToggleSource };
  skills: PackSkillState[];
}

type LowerLevel = Record<string, { projects: string[]; issues: string[] }>;

export interface SkillPacksSectionProps {
  level: SkillOverrideLevel;
  projectKey?: string;
  issueId?: string;
  packs: PackState[];
  packOverriddenBelow?: LowerLevel;
}

const ENDPOINT = '/api/skills/overrides';
const ADD_COMMAND = 'pan skills pack add mattpocock https://github.com/mattpocock/skills --ref v1.2.3';
const short = (commit: string) => commit.slice(0, 7);

const SOURCE_LABELS: Record<PackSkillSource, string> = {
  global: 'global',
  project: 'project',
  issue: 'issue',
  default: 'default',
  'global-pack': 'pack at global',
  'project-pack': 'pack at project',
  'issue-pack': 'pack at issue',
};

function belowNote(entry: { projects: string[]; issues: string[] } | undefined): string | null {
  if (!entry) return null;
  const parts: string[] = [];
  if (entry.projects.length) parts.push(`${entry.projects.length} project${entry.projects.length === 1 ? '' : 's'}`);
  if (entry.issues.length) parts.push(`${entry.issues.length} issue${entry.issues.length === 1 ? '' : 's'}`);
  return parts.length ? `set in ${parts.join(', ')}` : null;
}

async function fetchUpdates(): Promise<Record<string, string | null>> {
  const res = await fetch(`${ENDPOINT}?checkUpdates=1`);
  if (!res.ok) return {};
  const body = (await res.json().catch(() => ({}))) as { packs?: PackState[] };
  return Object.fromEntries((body.packs ?? []).map(pack => [pack.id, pack.updateAvailable ?? null]));
}

type SaveTarget = { pack: string } | { skill: string };
const targetKey = (target: SaveTarget) => ('pack' in target ? `pack:${target.pack}` : target.skill);

export function SkillPacksSection({ level, projectKey, issueId, packs, packOverriddenBelow = {} }: SkillPacksSectionProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, { message: string; target: SaveTarget; enabled: boolean | null }>>({});

  // The update check runs `git ls-remote`, so only the global page asks, separately from the main list.
  const updates = useQuery({
    queryKey: ['skill-pack-updates'],
    queryFn: fetchUpdates,
    enabled: level === 'global' && packs.length > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const save = async (target: SaveTarget, value: boolean | null) => {
    const key = targetKey(target);
    setSaving(prev => ({ ...prev, [key]: true }));
    setRowErrors(({ [key]: _cleared, ...rest }) => rest);
    try {
      const body = { level, ...target, enabled: value, ...(projectKey ? { projectKey } : {}), ...(issueId ? { issueId } : {}) };
      const res = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: await dashboardMutationJsonHeaders(ENDPOINT),
        body: JSON.stringify(body),
      });
      const result = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: SKILL_OVERRIDES_QUERY_KEY });
    } catch (error) {
      setRowErrors(prev => ({ ...prev, [key]: { message: error instanceof Error ? error.message : String(error), target, enabled: value } }));
    } finally {
      setSaving(({ [key]: _done, ...rest }) => rest);
    }
  };

  return (
    <section className="space-y-2" data-testid={`skill-packs-${level}`}>
      <h3 className="eyebrow">Skill packs</h3>
      {packs.length === 0 ? (
        <div className="rounded-md border border-border px-3 py-3 text-sm text-muted-foreground">
          No skill packs. Add one from the CLI:
          <code className="mt-1 block font-mono text-xs text-foreground">{ADD_COMMAND}</code>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {packs.map(pack => {
            const expanded = open[pack.id] === true;
            const optInCount = pack.skills.filter(skill => skill.optIn).length;
            const update = level === 'global' ? updates.data?.[pack.id] : null;
            const below = level === 'global' ? belowNote(packOverriddenBelow[pack.id]) : null;
            const packKey = targetKey({ pack: pack.id });
            return (
              <div key={pack.id} data-pack={pack.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_7rem] items-start gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(prev => ({ ...prev, [pack.id]: !expanded }))}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
                      <span className="font-mono">{pack.id}</span>
                    </button>
                    <p className="truncate pl-5 font-mono text-xs text-muted-foreground" title={pack.url}>
                      {pack.url} @ {pack.ref} ({short(pack.commit)})
                    </p>
                    <p className="pl-5 text-xs text-muted-foreground">
                      {[pack.license ?? 'license unknown', `${pack.skills.length} skills, ${optInCount} opt-in`, `Not applied: ${pack.notApplied.length ? pack.notApplied.join(', ') : 'none'}`].join(' · ')}
                    </p>
                    {!pack.cached && (
                      <p className="pl-5 text-xs text-muted-foreground">
                        Not cached; run <code className="font-mono">pan skills pack sync {pack.id}</code>
                      </p>
                    )}
                    {update && <p className="pl-5 text-xs text-muted-foreground">update available: <span className="font-mono">{short(update)}</span></p>}
                    {pack.duplicatePluginInstall && (
                      <p className="pl-5 text-xs text-muted-foreground">also installed as a Claude plugin — skills will appear twice</p>
                    )}
                    {below && <p className="pl-5 text-xs text-muted-foreground">{below}</p>}
                    <RowError error={rowErrors[packKey]} onRetry={retry => void save(retry.target, retry.enabled)} />
                  </div>
                  <Control
                    level={level}
                    label={`${pack.id} pack`}
                    checked={pack.global === true}
                    current={pack[level]}
                    inheritLabel={`Inherit (${pack.inherited.enabled ? 'on' : 'off'} via ${SOURCE_LABELS[pack.inherited.source]})`}
                    saving={saving[packKey] === true}
                    onToggle={() => void save({ pack: pack.id }, pack.global === true ? false : true)}
                    onSet={value => void save({ pack: pack.id }, value)}
                  />
                  <StateCell enabled={pack.enabled} source={SOURCE_LABELS[pack.source]} />
                </div>

                {expanded && (
                  <div className="divide-y divide-border border-t border-border bg-muted/30">
                    {pack.skills.length === 0 && (
                      <div className="px-3 py-2 pl-8 text-xs text-muted-foreground">No skills to show until the pack is cached.</div>
                    )}
                    {pack.skills.map(skill => (
                      <div key={skill.id} data-pack-skill={skill.id} className="grid grid-cols-[minmax(0,1fr)_auto_7rem] items-start gap-3 px-3 py-2 pl-8">
                        <div className="min-w-0">
                          <span className={cn('font-mono text-sm', skill.enabled ? 'text-foreground' : 'text-muted-foreground')}>{skill.id}</span>
                          {skill.description && <p className="truncate text-xs text-muted-foreground" title={skill.description}>{skill.description}</p>}
                          {skill.optIn && <p className="text-xs text-muted-foreground">Edits repo files; not turned on by the pack.</p>}
                          {skill.bundledOverlap && <p className="text-xs text-muted-foreground">Overdeck also bundles {skill.name}</p>}
                          <RowError error={rowErrors[skill.id]} onRetry={retry => void save(retry.target, retry.enabled)} />
                        </div>
                        <Control
                          level={level}
                          label={skill.id}
                          checked={skill.enabled}
                          current={skill[level]}
                          inheritLabel={`Inherit (${skill.inherited.enabled ? 'on' : 'off'} via ${SOURCE_LABELS[skill.inherited.source]})`}
                          saving={saving[skill.id] === true}
                          onToggle={() => void save({ skill: skill.id }, !skill.enabled)}
                          onSet={value => void save({ skill: skill.id }, value)}
                        />
                        <StateCell enabled={skill.enabled} source={SOURCE_LABELS[skill.source]} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface RowErrorState {
  message: string;
  target: SaveTarget;
  enabled: boolean | null;
}

function RowError({ error, onRetry }: { error?: RowErrorState; onRetry: (error: RowErrorState) => void }) {
  if (!error) return null;
  return (
    <p className="mt-1 flex items-center gap-2 text-xs text-destructive" role="alert">
      Save failed: {error.message}
      <button type="button" className="underline" onClick={() => onRetry(error)}>Retry</button>
    </p>
  );
}

interface ControlProps {
  level: SkillOverrideLevel;
  label: string;
  checked: boolean;
  current: boolean | null;
  inheritLabel: string;
  saving: boolean;
  onToggle: () => void;
  onSet: (value: boolean | null) => void;
}

function Control({ level, label, checked, current, inheritLabel, saving, onToggle, onSet }: ControlProps) {
  if (level === 'global') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${label} global`}
        disabled={saving}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors disabled:cursor-not-allowed',
          checked ? 'bg-foreground' : 'bg-muted',
        )}
      >
        <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
    );
  }
  return (
    <div role="group" aria-label={`${label} at ${level} level`} className="inline-flex overflow-hidden rounded-md border border-border text-xs">
      {([[null, inheritLabel], [true, 'On'], [false, 'Off']] as const).map(([value, text]) => (
        <button
          key={String(value)}
          type="button"
          aria-pressed={current === value}
          disabled={saving}
          onClick={() => onSet(value)}
          className={cn('px-2 py-1 text-muted-foreground transition-colors hover:bg-muted', current === value && 'bg-muted text-foreground')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function StateCell({ enabled, source }: { enabled: boolean; source: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-sm text-foreground">{enabled ? 'on' : 'off'}</div>
      <div className="font-mono text-xs text-muted-foreground">{source}</div>
    </div>
  );
}
