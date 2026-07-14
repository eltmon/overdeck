import type { SettingsConfig } from '../types';

export function SwarmSettingsSection({ formData, onSettingsChange }: { formData: SettingsConfig; onSettingsChange: (next: SettingsConfig) => void }) {
  const value = formData.swarm ?? { mode: 'off' as const, maxSlots: 3, autoAdvance: true };
  const update = (patch: Partial<typeof value>) => onSettingsChange({ ...formData, swarm: { ...value, ...patch } });
  return <section id="swarming" className="scroll-mt-4 border-t border-border py-6">
    <h2 className="mb-1 text-base font-semibold tracking-tight text-foreground">Swarming</h2>
    <p className="mb-5 max-w-[70ch] text-sm text-muted-foreground">Control whether Overdeck may split future issue work across parallel agents. Swarming is off unless you opt in; an explicit <code className="font-mono">pan swarm</code> remains available.</p>
    <div className="flex max-w-2xl flex-col gap-5">
      <label className="flex items-center justify-between gap-6"><span><span className="block text-sm font-medium">Automatic selection</span><span className="block text-xs text-muted-foreground">Off uses one work agent. Auto requires a safely partitioned plan. Always refuses plans that cannot swarm.</span></span><select aria-label="Global swarm mode" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={value.mode} onChange={e => update({ mode: e.target.value as typeof value.mode })}><option value="off">Off</option><option value="auto">Auto</option><option value="always">Always</option></select></label>
      <label className="flex items-center justify-between gap-6"><span className="text-sm font-medium">Maximum slots per issue</span><input aria-label="Global maximum swarm slots" type="number" min={1} max={12} className="w-20 rounded-md border border-input bg-background px-3 py-2 text-sm" value={value.maxSlots} onChange={e => update({ maxSlots: Number(e.target.value) })} /></label>
      <label className="flex items-center justify-between gap-6"><span><span className="block text-sm font-medium">Advance waves automatically</span><span className="block text-xs text-muted-foreground">Dispatch the next eligible plan items as slots finish.</span></span><input aria-label="Global swarm auto advance" type="checkbox" checked={value.autoAdvance} onChange={e => update({ autoAdvance: e.target.checked })} /></label>
    </div>
  </section>;
}
