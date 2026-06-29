import { type UIPreferences } from '../../../hooks/useUIPreferences';

interface AppearanceSectionProps {
  uiPrefs: UIPreferences;
  updateUIPrefs: (patch: Partial<UIPreferences>) => void;
}

export function AppearanceSection({ uiPrefs, updateUIPrefs }: AppearanceSectionProps) {
  return (
    <section id="appearance" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
        Appearance
      </h2>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Ready to Merge shimmer</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Animate the badge with a subtle shimmer for cards awaiting merge approval
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={uiPrefs.readyToMergeShimmer}
            aria-label="Toggle Ready to Merge shimmer"
            onClick={() => updateUIPrefs({ readyToMergeShimmer: !uiPrefs.readyToMergeShimmer })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              uiPrefs.readyToMergeShimmer ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              uiPrefs.readyToMergeShimmer ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
      </div>
    </section>
  );
}
