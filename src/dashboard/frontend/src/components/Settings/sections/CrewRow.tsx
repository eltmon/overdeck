import { useState } from 'react';
import { MODELS_BY_PROVIDER } from '../modelCatalog';
import type { Harness, SettingsConfig } from '../types';
import {
  blendedCost,
  crewLabel,
  providerDefaultHarness,
  type Crew,
  type CrewEntry,
} from './tiered-crews';

const HARNESSES: Harness[] = ['claude-code', 'ohmypi', 'codex'];

function ModelSelect({ value, onChange, label = 'Model' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <label className="space-y-1.5"><span className="text-xs font-medium text-foreground">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground">
    {!Object.values(MODELS_BY_PROVIDER).some((provider) => provider.models.some((model) => model.id === value)) && <option value={value}>{value}</option>}
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

export function CrewRow({ crew, owned, ownedKinds, settings, open, onToggle, onChange, onRemove }: {
  crew: Crew;
  owned: string[];
  ownedKinds: string[];
  settings: SettingsConfig;
  open: boolean;
  onToggle: () => void;
  onChange: (crew: Crew) => void;
  onRemove: () => void;
}) {
  const [removeError, setRemoveError] = useState<string | null>(null);
  const entries = crew.distribution;
  const total = entries?.reduce((sum, entry) => sum + entry.weight, 0) ?? 100;
  const mismatch = (entry: Pick<CrewEntry, 'model' | 'harness'>) => entry.harness !== providerDefaultHarness(entry.model, settings);
  const warning = entries ? entries.some(mismatch) : mismatch(crew);
  const cost = blendedCost(crew);

  const updateEntries = (next: CrewEntry[]) => {
    const representative = next.reduce((best, entry) => entry.weight > best.weight ? entry : best);
    onChange({ ...crew, model: representative.model, harness: representative.harness, distribution: next });
  };

  return <details open={open} className="rounded-lg border border-border/70">
    <summary onClick={(event) => { event.preventDefault(); onToggle(); }} className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 focus-visible:ring-2 focus-visible:ring-primary">
      <span aria-hidden>{open ? '▾' : '▸'}</span><span className="font-medium text-foreground">{crewLabel(crew)}</span>
      {warning && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">⚠ harness overrides provider default — PAN-1865</span>}
      <span className="ml-auto text-[11px] text-muted-foreground">{owned.length || ownedKinds.length ? `handles ${[...owned, ...ownedKinds.map((kind) => `${kind} override`)].join(' · ')}` : 'handles nothing — assign it on the board or remove it'}</span>
      <span className="text-[11px] font-medium text-cyan-600 dark:text-cyan-400">{cost == null ? '—' : `≈ $${cost.toFixed(1)}/1M`}</span>
    </summary>
    <div className="space-y-3 border-t border-border/70 px-4 py-3">
      {!entries ? <div className="grid gap-3 @xl:grid-cols-2">
        <ModelSelect value={crew.model} onChange={(model) => onChange({ ...crew, model })} />
        <HarnessSelect model={crew.model} value={crew.harness} settings={settings} onChange={(harness) => onChange({ ...crew, harness })} />
      </div> : <>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label="Crew weight distribution">{entries.map((entry, index) => <span key={`${entry.model}-${index}`} className="inline-block h-full bg-primary" style={{ width: `${entry.weight}%`, opacity: 1 - index * 0.12 }} />)}</div>
        <div className={`text-xs ${total === 100 ? 'text-muted-foreground' : 'text-destructive'}`}>Total: {total}% {total === 100 ? '' : '— must total 100%'}</div>
        {entries.map((entry, index) => <div key={index} className="grid gap-2 @xl:grid-cols-[1.4fr_1fr_90px_auto]">
          <ModelSelect label={`Model ${index + 1}`} value={entry.model} onChange={(model) => updateEntries(entries.map((item, i) => i === index ? { ...item, model } : item))} />
          <HarnessSelect label={`Harness ${index + 1}`} model={entry.model} value={entry.harness} settings={settings} onChange={(harness) => updateEntries(entries.map((item, i) => i === index ? { ...item, harness } : item))} />
          <label className="space-y-1.5"><span className="text-xs font-medium text-foreground">Weight</span><input aria-label={`Weight ${index + 1}`} type="number" min={0} max={100} value={entry.weight} onChange={(event) => updateEntries(entries.map((item, i) => i === index ? { ...item, weight: Number(event.target.value) } : item))} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" /></label>
          <button type="button" aria-label={`Remove model ${index + 1}`} onClick={() => entries.length === 1 ? onChange({ ...crew, distribution: undefined }) : updateEntries(entries.filter((_, i) => i !== index))} className="self-end rounded-md border border-border px-2 py-1.5 text-xs">Remove</button>
        </div>)}
        <button type="button" onClick={() => updateEntries([...entries, { model: DEFAULT_CREW_MODEL, harness: providerDefaultHarness(DEFAULT_CREW_MODEL, settings), weight: 0 }])} className="rounded-md border border-border px-2.5 py-1.5 text-xs">Add model</button>
      </>}
      <div className="flex justify-between gap-2">
        <button type="button" onClick={() => entries ? onChange({ ...crew, distribution: undefined }) : onChange({ ...crew, distribution: [{ model: crew.model, harness: crew.harness, weight: 100 }] })} className="rounded-md border border-border px-2.5 py-1.5 text-xs">{entries ? 'Use one model' : 'Use a weighted mix'}</button>
        <button type="button" onClick={() => {
          if (owned.length) setRemoveError('Assign these difficulties to another crew before removing it.');
          else if (ownedKinds.length) setRemoveError('Move or remove these kind overrides before removing this crew.');
          else onRemove();
        }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground">Remove crew</button>
      </div>
      {removeError && <p className="text-xs text-destructive">{removeError}</p>}
    </div>
  </details>;
}

const DEFAULT_CREW_MODEL = 'claude-haiku-4-5';
