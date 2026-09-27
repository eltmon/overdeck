import { MODELS_BY_PROVIDER } from '../modelCatalog';
import type { TierFitnessWarning } from '../../../../../../lib/agents/tier-fitness.js';
import type { Harness, SettingsConfig, WorkhorsesConfig } from '../types';
import {
  blendedCost,
  crewLabel,
  isWorkhorseModelRef,
  providerDefaultHarness,
  resolveWorkhorseModel,
  WORKHORSE_SLOT_IDS,
  type Crew,
  type CrewEntry,
} from './tiered-crews';

const HARNESSES: Harness[] = ['claude-code', 'ohmypi', 'codex', 'acp', 'kimi-code', 'opencode', 'muse'];

/** PAN-4191: a `workhorse:<slot>` ref follows the workhorse settings; the option shows what it resolves to. */
export function WorkhorseOptions({ workhorses }: { workhorses: WorkhorsesConfig | undefined }) {
  return <optgroup label="Workhorse">
    {WORKHORSE_SLOT_IDS.map((slot) => <option key={slot} value={`workhorse:${slot}`}>workhorse:{slot} ({workhorses?.[slot] ?? 'not set'})</option>)}
  </optgroup>;
}

export function ModelSelect({ value, onChange, workhorses, label = 'Model' }: { value: string; onChange: (value: string) => void; workhorses: WorkhorsesConfig | undefined; label?: string }) {
  const known = isWorkhorseModelRef(value) || Object.values(MODELS_BY_PROVIDER).some((provider) => provider.models.some((model) => model.id === value));
  return <label className="space-y-1.5"><span className="text-xs font-medium text-foreground">{label}</span><select aria-label={label} value={value} title={isWorkhorseModelRef(value) ? `${value} = ${resolveWorkhorseModel(value, workhorses)}` : undefined} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
    {!known && <option value={value}>{value}</option>}
    <WorkhorseOptions workhorses={workhorses} />
    {Object.entries(MODELS_BY_PROVIDER).map(([id, provider]) => <optgroup key={id} label={provider.name}>{provider.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</optgroup>)}
  </select></label>;
}

function HarnessSelect({ model, value, settings, onChange, label = 'Harness' }: { model: string; value: Harness; settings: SettingsConfig; onChange: (value: Harness) => void; label?: string }) {
  const automatic = providerDefaultHarness(model, settings);
  return <label className="space-y-1.5"><span className="text-xs font-medium text-foreground">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value === 'auto' ? automatic : event.target.value as Harness)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
    <option value="auto">auto ({automatic})</option>
    {HARNESSES.map((harness) => <option key={harness} value={harness}>{harness}</option>)}
  </select></label>;
}

export function CrewRow({ crew, owned, ownedKinds, settings, open, onToggle, onChange, onRequestRemove, warnings = [], workModel }: {
  crew: Crew;
  owned: string[];
  ownedKinds: string[];
  settings: SettingsConfig;
  open: boolean;
  onToggle: () => void;
  onChange: (crew: Crew) => void;
  onRequestRemove: () => void;
  warnings?: TierFitnessWarning[];
  /** PAN-4191: roles.work's effective model, set while tiered execution is on. */
  workModel?: string;
}) {
  const entries = crew.distribution;
  const total = entries?.reduce((sum, entry) => sum + entry.weight, 0) ?? 100;
  const mismatch = (entry: Pick<CrewEntry, 'model' | 'harness'>) => entry.harness !== providerDefaultHarness(entry.model, settings);
  const warning = entries ? entries.some(mismatch) : mismatch(crew);
  const cost = blendedCost(crew, undefined, settings.workhorses);
  const overridesWork = workModel !== undefined
    && (entries ?? [crew]).some((entry) => resolveWorkhorseModel(entry.model, settings.workhorses) !== workModel);

  const updateEntries = (next: CrewEntry[]) => {
    const representative = next.reduce((best, entry) => entry.weight > best.weight ? entry : best);
    onChange({ ...crew, model: representative.model, harness: representative.harness, distribution: next });
  };

  return <details open={open} className="rounded-lg border border-border/70">
    <summary onClick={(event) => { event.preventDefault(); onToggle(); }} className="group flex cursor-pointer list-none items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary focus-within:bg-muted/40">
      <span aria-hidden>{open ? '▾' : '▸'}</span>
      <span className="text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100">edit</span>
      <span className="font-medium text-foreground">{crewLabel(crew, undefined, settings.workhorses)}</span>
      {overridesWork && <span data-testid="crew-overrides-work" title={`While tiered execution is on, planned issues this crew handles run on it instead of roles.work (${workModel}).`} className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">overrides roles.work ({workModel})</span>}
      {warning && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">⚠ harness overrides provider default — PAN-1865</span>}
      {warnings.map((fitnessWarning, fitnessIndex) => <span key={`${fitnessWarning.code}:${fitnessWarning.model}:${fitnessIndex}`} data-testid="tier-fitness-warning" title={fitnessWarning.message} className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">⚠ {fitnessWarning.message.replace(/^tiered_execution\.tiers\.[^:]+: /, '')}</span>)}
      <span className="ml-auto text-[11px] text-muted-foreground">{owned.length || ownedKinds.length ? `handles ${[...owned, ...ownedKinds.map((kind) => `${kind} override`)].join(' · ')}` : 'handles nothing — assign it on the board or remove it'}</span>
      <span className="text-[11px] font-medium text-cyan-600 dark:text-cyan-400">{cost == null ? '—' : `≈ $${cost.toFixed(1)}/1M`}</span>
      {!open && <button
        type="button"
        aria-label={`Remove crew ${crewLabel(crew)}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRequestRemove();
        }}
        className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary"
      >
        × remove
      </button>}
    </summary>
    <div className="space-y-3 border-t border-border/70 px-4 py-3">
      {!entries ? <div className="grid gap-3 @xl:grid-cols-2">
        <ModelSelect value={crew.model} workhorses={settings.workhorses} onChange={(model) => onChange({ ...crew, model })} />
        <HarnessSelect model={crew.model} value={crew.harness} settings={settings} onChange={(harness) => onChange({ ...crew, harness })} />
      </div> : <>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label="Crew weight distribution">{entries.map((entry, index) => <span key={`${entry.model}-${index}`} className="inline-block h-full bg-primary" style={{ width: `${entry.weight}%`, opacity: 1 - index * 0.12 }} />)}</div>
        <div className={`text-xs ${total === 100 ? 'text-muted-foreground' : 'text-destructive'}`}>Total: {total}% {total === 100 ? '' : '— must total 100%'}</div>
        {entries.map((entry, index) => <div key={index} className="grid gap-2 @xl:grid-cols-[1.4fr_1fr_90px_auto]">
          <ModelSelect label={`Model ${index + 1}`} value={entry.model} workhorses={settings.workhorses} onChange={(model) => updateEntries(entries.map((item, i) => i === index ? { ...item, model } : item))} />
          <HarnessSelect label={`Harness ${index + 1}`} model={entry.model} value={entry.harness} settings={settings} onChange={(harness) => updateEntries(entries.map((item, i) => i === index ? { ...item, harness } : item))} />
          <label className="space-y-1.5"><span className="text-xs font-medium text-foreground">Weight</span><input aria-label={`Weight ${index + 1}`} type="number" min={0} max={100} value={entry.weight} onChange={(event) => updateEntries(entries.map((item, i) => i === index ? { ...item, weight: Number(event.target.value) } : item))} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
          <button type="button" aria-label={`Remove model ${index + 1}`} onClick={() => entries.length === 1 ? onChange({ ...crew, distribution: undefined }) : updateEntries(entries.filter((_, i) => i !== index))} className="self-end rounded-md border border-border px-2 py-1.5 text-xs">Remove</button>
        </div>)}
        <button type="button" onClick={() => updateEntries([...entries, { model: DEFAULT_CREW_MODEL, harness: providerDefaultHarness(DEFAULT_CREW_MODEL, settings), weight: 0 }])} className="rounded-md border border-border px-2.5 py-1.5 text-xs">Add model</button>
      </>}
      <div className="flex justify-between gap-2">
        <button type="button" onClick={() => entries ? onChange({ ...crew, distribution: undefined }) : onChange({ ...crew, distribution: [{ model: crew.model, harness: crew.harness, weight: 100 }] })} className="rounded-md border border-border px-2.5 py-1.5 text-xs">{entries ? 'Use one model' : 'Use a weighted mix'}</button>
        <button type="button" onClick={onRequestRemove} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground">Remove crew</button>
      </div>
    </div>
  </details>;
}

const DEFAULT_CREW_MODEL = 'claude-haiku-4-5';
