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
import { useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { cn } from '../../lib/utils';
import { GroupHeader, LevelChoice, RowError as SaveError, SkillSwitch } from './SkillControls';

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
  disclosure: string | null;
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
  /** Lowercased filter text from the panel; packs holding a match open, others hide. */
  search?: string;
  /** Lets the panel's summary line jump to this section. */
  sectionRef?: RefObject<HTMLElement>;
}

const ENDPOINT = '/api/skills/overrides';
const ADD_COMMAND = 'pan skills pack add mattpocock https://github.com/eltmon/skills --ref v1.2.3';
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

export function SkillPacksSection({ level, projectKey, issueId, packs, packOverriddenBelow = {}, search = '', sectionRef }: SkillPacksSectionProps) {
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

  const matches = (skill: PackSkillState) =>
    !search || skill.id.toLowerCase().includes(search) || skill.description.toLowerCase().includes(search);
  const shown = packs
    .map(pack => ({ pack, skills: pack.skills.filter(matches) }))
    .filter(({ pack, skills }) => !search || skills.length > 0 || pack.id.toLowerCase().includes(search));
  if (search && shown.length === 0) return null;

  return (
    <section ref={sectionRef} tabIndex={-1} aria-label="Skill packs" className="scroll-mt-4 space-y-2 pt-2 focus:outline-none" data-testid={`skill-packs-${level}`}>
      <div>
        <h3 className="text-[13px] font-medium text-foreground">Skill packs</h3>
        <p className="max-w-[72ch] text-xs leading-5 text-muted-foreground">
          Skill sets from other repositories. Pack skills stay off until you turn on the pack or the skill; opt-in skills ignore the pack switch.
        </p>
      </div>
      {packs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          No skill packs. Add one from the CLI:
          <code className="mt-1 block font-mono text-xs text-foreground">{ADD_COMMAND}</code>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {shown.map(({ pack, skills }, index) => {
            const expanded = open[pack.id] ?? (search !== '' && skills.length > 0);
            const optInCount = pack.skills.filter(skill => skill.optIn).length;
            const onCount = pack.skills.filter(skill => skill.enabled).length;
            const update = level === 'global' ? updates.data?.[pack.id] : null;
            const below = level === 'global' ? belowNote(packOverriddenBelow[pack.id]) : null;
            const packKey = targetKey({ pack: pack.id });
            const packError = rowErrors[packKey];
            return (
              <div key={pack.id} data-pack={pack.id} className={cn(index > 0 && 'border-t border-border')}>
                <GroupHeader
                  title={pack.id}
                  mono
                  open={expanded}
                  onToggle={() => setOpen(prev => ({ ...prev, [pack.id]: !expanded }))}
                  hint={`${pack.license ?? 'license unknown'} · ${pack.skills.length} skills`}
                  count={search && skills.length !== pack.skills.length ? `${skills.length} match${skills.length === 1 ? '' : 'es'}` : `${onCount} of ${pack.skills.length} on`}
                  control={(
                    <PackControl
                      level={level}
                      label={`${pack.id} pack`}
                      checked={pack.global === true}
                      current={pack[level]}
                      inheritLabel={`Inherit (${pack.inherited.enabled ? 'on' : 'off'} via ${SOURCE_LABELS[pack.inherited.source]})`}
                      saving={saving[packKey] === true}
                      onToggle={() => void save({ pack: pack.id }, pack.global === true ? false : true)}
                      onSet={value => void save({ pack: pack.id }, value)}
                    />
                  )}
                >
                  <div className="space-y-0.5 pl-[26px] text-xs leading-5">
                    {pack.disclosure && (
                      <p className="max-w-[96ch] text-body-foreground" data-testid="pack-disclosure">{pack.disclosure}</p>
                    )}
                    {!pack.cached && (
                      <p className="text-muted-foreground">
                        Not cached; run <code className="font-mono">pan skills pack sync {pack.id}</code>
                      </p>
                    )}
                    {update && <p className="text-muted-foreground">update available: <span className="font-mono">{short(update)}</span></p>}
                    {pack.duplicatePluginInstall && (
                      <p className="text-muted-foreground">also installed as a Claude plugin — skills will appear twice</p>
                    )}
                    {below && <p className="text-body-foreground">{below}</p>}
                    {packError && <SaveError message={packError.message} onRetry={() => void save(packError.target, packError.enabled)} />}
                  </div>
                </GroupHeader>

                {expanded && (
                  <div className="border-t border-border">
                    <div className="space-y-0.5 list-meta px-3 py-2 pl-9 text-xs leading-5 text-muted-foreground">
                      <p className="truncate font-mono" title={pack.url}>{pack.url} @ {pack.ref} ({short(pack.commit)})</p>
                      <p>{[`${optInCount} opt-in`, `Not applied: ${pack.notApplied.length ? pack.notApplied.join(', ') : 'none'}`].join(' · ')}</p>
                    </div>
                    {pack.skills.length === 0 && (
                      <div className="border-t border-border px-3 py-2 pl-9 text-xs text-muted-foreground">No skills to show until the pack is cached.</div>
                    )}
                    <div className="divide-y divide-border border-t border-border">
                      {skills.map(skill => {
                        const skillError = rowErrors[skill.id];
                        return (
                          <div
                            key={skill.id}
                            data-pack-skill={skill.id}
                            className={cn(
                              'list-row grid items-start gap-x-4 gap-y-1 px-3 py-2 pl-9',
                              level === 'global'
                                ? 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)_auto]'
                                : 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)_auto_4.5rem]',
                            )}
                          >
                            <div className="flex min-w-0 items-baseline gap-2 pt-px">
                              <span className={cn('truncate font-mono-ui text-[13px]', skill.enabled ? 'text-foreground' : 'text-muted-foreground')}>{skill.id}</span>
                              {skill.optIn && (
                                <span className="shrink-0 rounded border border-border px-1 text-[11px] leading-4 text-muted-foreground" title="Edits repo files; not turned on by the pack.">
                                  opt-in<span className="sr-only">: </span><span className="sr-only">Edits repo files; not turned on by the pack.</span>
                                </span>
                              )}
                            </div>
                            <div className="col-start-1 row-start-2 min-w-0 md:col-start-2 md:row-start-1">
                              {skill.description && <p className="line-clamp-2 text-xs leading-5 text-muted-foreground md:line-clamp-1" title={skill.description}>{skill.description}</p>}
                              {skill.bundledOverlap && <p className="text-xs leading-5 text-muted-foreground">Overdeck also bundles {skill.name}</p>}
                              {skillError && <SaveError message={skillError.message} onRetry={() => void save(skillError.target, skillError.enabled)} />}
                            </div>
                            <div className="col-start-2 row-span-2 row-start-1 flex justify-end self-center md:col-start-3 md:row-span-1">
                              <PackControl
                                level={level}
                                label={skill.id}
                                checked={skill.enabled}
                                current={skill[level]}
                                inheritLabel={`Inherit (${skill.inherited.enabled ? 'on' : 'off'} via ${SOURCE_LABELS[skill.inherited.source]})`}
                                saving={saving[skill.id] === true}
                                onToggle={() => void save({ skill: skill.id }, !skill.enabled)}
                                onSet={value => void save({ skill: skill.id }, value)}
                              />
                            </div>
                            {level !== 'global' && <StateCell enabled={skill.enabled} source={SOURCE_LABELS[skill.source]} />}
                          </div>
                        );
                      })}
                    </div>
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

interface PackControlProps {
  level: SkillOverrideLevel;
  label: string;
  checked: boolean;
  current: boolean | null;
  inheritLabel: string;
  saving: boolean;
  onToggle: () => void;
  onSet: (value: boolean | null) => void;
}

function PackControl({ level, label, checked, current, inheritLabel, saving, onToggle, onSet }: PackControlProps) {
  if (level === 'global') return <SkillSwitch checked={checked} label={`${label} global`} disabled={saving} onToggle={onToggle} />;
  return <LevelChoice label={`${label} at ${level} level`} current={current} inheritLabel={inheritLabel} saving={saving} onSet={onSet} />;
}

function StateCell({ enabled, source }: { enabled: boolean; source: string }) {
  return (
    <div className="hidden text-right font-mono-ui text-xs leading-5 md:block">
      <span className={enabled ? 'text-foreground' : 'text-muted-foreground'}>{enabled ? 'on' : 'off'}</span>
      <span className="block text-muted-foreground">{source}</span>
    </div>
  );
}
