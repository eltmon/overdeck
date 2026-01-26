export interface ThinkingLevelSliderProps {
  value: number; // 1-4 (Minimal, Low, Medium, High)
  onChange: (value: number) => void;
}

const THINKING_LEVELS = ['Fast', 'Balanced', 'Deep'];
const THINKING_LEVEL_LABELS: Record<number, string> = {
  1: 'Minimal',
  2: 'Low',
  3: 'Medium',
  4: 'High',
};

export function ThinkingLevelSlider({ value, onChange }: ThinkingLevelSliderProps) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs font-semibold text-[#a390cb] uppercase tracking-wider">
        <span>Gemini Thinking Level</span>
        <span className="text-[#a078f7]">{THINKING_LEVEL_LABELS[value]}</span>
      </div>
      <input
        type="range"
        min="1"
        max="4"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#a078f7]"
      />
      <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase">
        {THINKING_LEVELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}
