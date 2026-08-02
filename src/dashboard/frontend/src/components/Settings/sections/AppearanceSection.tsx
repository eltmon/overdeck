import { toast } from 'sonner';
import { type UIPreferences } from '../../../hooks/useUIPreferences';
import { useDesignLanguage, type DesignLanguage } from '../../../hooks/useDesignLanguage';

interface AppearanceSectionProps {
  uiPrefs: UIPreferences;
  updateUIPrefs: (patch: Partial<UIPreferences>) => void;
}

const THEME_CARDS: Array<{ id: DesignLanguage; name: string; description: string }> = [
  { id: 'ledger', name: 'Ledger', description: 'The classic dense monitoring style' },
  {
    id: 'broadsheet',
    name: 'Broadsheet',
    description: 'The new editorial style — Geist type, display scale, chips, soft cards',
  },
];

export function AppearanceSection({ uiPrefs, updateUIPrefs }: AppearanceSectionProps) {
  const designLanguage = useDesignLanguage((state) => state.designLanguage);
  const setDesignLanguage = useDesignLanguage((state) => state.setDesignLanguage);

  return (
    <section id="appearance" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
        Appearance
      </h2>

      <div className="mb-6">
        <span className="text-sm font-medium text-foreground">Overdeck Theme</span>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          Choose the dashboard's design language.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {THEME_CARDS.map((card) => {
            const isSelected = designLanguage === card.id;
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={isSelected}
                data-testid={`theme-card-${card.id}`}
                onClick={async () => {
                  try {
                    await setDesignLanguage(card.id);
                  } catch (err) {
                    toast.error(`Failed to save Overdeck Theme: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  isSelected ? 'border-foreground/40 bg-muted' : 'border-border bg-background/60 hover:bg-muted/30'
                }`}
              >
                <span className="block text-sm font-medium text-foreground">{card.name}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{card.description}</p>
                <div
                  data-theme={card.id}
                  data-testid={`theme-specimen-${card.id}`}
                  className="mt-3 rounded-md border border-dashed border-border bg-background/60 p-3"
                >
                  <p className="eyebrow">Overdeck</p>
                  <p className="display-lg text-foreground mt-1">Aa</p>
                  <span className="mt-2 inline-block rounded-sm border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Sample chip
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

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
