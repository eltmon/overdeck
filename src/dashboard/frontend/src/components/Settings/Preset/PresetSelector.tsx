import { ModelPreset } from '../types';
import { PresetCard } from './PresetCard';

export interface PresetSelectorProps {
  selected: ModelPreset;
  onChange: (preset: ModelPreset) => void;
}

export function PresetSelector({ selected, onChange }: PresetSelectorProps) {
  const presets: ModelPreset[] = ['premium', 'balanced', 'budget'];

  return (
    <section className="mb-12">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">Model Routing Presets</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {presets.map((preset) => (
          <PresetCard key={preset} preset={preset} selected={selected === preset} onSelect={() => onChange(preset)} />
        ))}
      </div>
    </section>
  );
}
