import { type DiffPreferences } from '../../../hooks/useDiffPreferences';

interface DiffSectionProps {
  diffPrefs: DiffPreferences;
  updateDiffPrefs: (patch: Partial<DiffPreferences>) => void;
}

export function DiffSection({ diffPrefs, updateDiffPrefs }: DiffSectionProps) {
  return (
    <section id="diff" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">Diff</h2>
      <div className="space-y-1">
        {/* diffRenderMode */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Diff style</span>
            <p className="text-xs text-muted-foreground mt-0.5">Unified (stacked) or split (side-by-side)</p>
          </div>
          <select
            value={diffPrefs.diffRenderMode}
            onChange={(e) => updateDiffPrefs({ diffRenderMode: e.target.value as 'stacked' | 'split' })}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
          >
            <option value="stacked">Stacked (unified)</option>
            <option value="split">Split (side-by-side)</option>
          </select>
        </div>

        {/* diffWordWrap */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Line wrapping</span>
            <p className="text-xs text-muted-foreground mt-0.5">Wrap long lines instead of scrolling horizontally</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={diffPrefs.diffWordWrap}
            aria-label="Toggle line wrapping"
            onClick={() => updateDiffPrefs({ diffWordWrap: !diffPrefs.diffWordWrap })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              diffPrefs.diffWordWrap ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              diffPrefs.diffWordWrap ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>

        {/* lineDiffType */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Intra-line diff granularity</span>
            <p className="text-xs text-muted-foreground mt-0.5">How finely to highlight changes within a single line</p>
          </div>
          <select
            value={diffPrefs.lineDiffType}
            onChange={(e) => updateDiffPrefs({ lineDiffType: e.target.value as 'word-alt' | 'word' | 'char' | 'none' })}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
          >
            <option value="word-alt">Word-alt (join adjacent)</option>
            <option value="word">Word</option>
            <option value="char">Character</option>
            <option value="none">None</option>
          </select>
        </div>

        {/* diffIndicators */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Change indicators</span>
            <p className="text-xs text-muted-foreground mt-0.5">Classic +/- prefixes, colored bars, or none</p>
          </div>
          <select
            value={diffPrefs.diffIndicators}
            onChange={(e) => updateDiffPrefs({ diffIndicators: e.target.value as 'classic' | 'bars' | 'none' })}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
          >
            <option value="bars">Bars</option>
            <option value="classic">Classic (+/-)</option>
            <option value="none">None</option>
          </select>
        </div>

        {/* hunkSeparators */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Hunk separators</span>
            <p className="text-xs text-muted-foreground mt-0.5">How collapsed hunks are displayed between change groups</p>
          </div>
          <select
            value={diffPrefs.hunkSeparators}
            onChange={(e) => updateDiffPrefs({ hunkSeparators: e.target.value as 'simple' | 'metadata' | 'line-info' | 'line-info-basic' })}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
          >
            <option value="line-info">Line info</option>
            <option value="line-info-basic">Line info (basic)</option>
            <option value="simple">Simple</option>
            <option value="metadata">Metadata</option>
          </select>
        </div>

        {/* expandUnchanged */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Expand unchanged</span>
            <p className="text-xs text-muted-foreground mt-0.5">Auto-expand all unchanged context lines</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={diffPrefs.expandUnchanged}
            aria-label="Toggle expand unchanged"
            onClick={() => updateDiffPrefs({ expandUnchanged: !diffPrefs.expandUnchanged })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              diffPrefs.expandUnchanged ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              diffPrefs.expandUnchanged ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>

        {/* collapsedContextThreshold */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Collapsed context threshold</span>
            <p className="text-xs text-muted-foreground mt-0.5">Lines of context before collapsing unchanged blocks</p>
          </div>
          <input
            type="number"
            min={0}
            max={20}
            value={diffPrefs.collapsedContextThreshold}
            onChange={(e) => updateDiffPrefs({ collapsedContextThreshold: Math.max(0, Math.min(20, Number(e.target.value))) })}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary w-[80px]"
          />
        </div>

        {/* lineHoverHighlight */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Line hover highlight</span>
            <p className="text-xs text-muted-foreground mt-0.5">Highlight lines on mouse hover</p>
          </div>
          <select
            value={diffPrefs.lineHoverHighlight}
            onChange={(e) => updateDiffPrefs({ lineHoverHighlight: e.target.value as 'disabled' | 'both' | 'number' | 'line' })}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
          >
            <option value="disabled">Disabled</option>
            <option value="both">Both (number + line)</option>
            <option value="number">Number only</option>
            <option value="line">Line only</option>
          </select>
        </div>

        {/* disableLineNumbers */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Hide line numbers</span>
            <p className="text-xs text-muted-foreground mt-0.5">Remove line number columns from diff view</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={diffPrefs.disableLineNumbers}
            aria-label="Toggle hide line numbers"
            onClick={() => updateDiffPrefs({ disableLineNumbers: !diffPrefs.disableLineNumbers })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              diffPrefs.disableLineNumbers ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              diffPrefs.disableLineNumbers ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>

        {/* enableLineSelection */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Enable line selection</span>
            <p className="text-xs text-muted-foreground mt-0.5">Multi-line selection with shift-click</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={diffPrefs.enableLineSelection}
            aria-label="Toggle enable line selection"
            onClick={() => updateDiffPrefs({ enableLineSelection: !diffPrefs.enableLineSelection })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              diffPrefs.enableLineSelection ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              diffPrefs.enableLineSelection ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>
      </div>
    </section>
  );
}
