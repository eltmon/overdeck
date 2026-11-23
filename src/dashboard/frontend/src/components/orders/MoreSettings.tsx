/**
 * The book settings the operator rarely touches (PAN-5597 WI-6): the extra
 * instructions file added to every issue's kickoff brief, and a preview of
 * what the Flywheel receives. Collapsed by default. Key it by book id so a
 * new book starts with fresh field state.
 */
import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { bookPath, errorMessage, orderBookRequest, type OrderBookEditorProps } from './orderBookApi';

const BRIEF_DEBOUNCE_MS = 550;
const SAVED_FADE_MS = 1600;
const BRIEF_MD_PATTERN = /\.md$/i;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function briefStatus(value: string): { text: string; tone: 'muted' | 'error' } {
  const trimmed = value.trim();
  if (trimmed === '') return { text: "Optional. A markdown file added to every issue's kickoff brief.", tone: 'muted' };
  if (BRIEF_MD_PATTERN.test(trimmed)) return { text: "Added to every issue's kickoff brief.", tone: 'muted' };
  return { text: 'Not a markdown file. Use a repo path that ends in .md.', tone: 'error' };
}

export function MoreSettings({ book, project, onBookChange, onError }: OrderBookEditorProps) {
  const [briefOverlay, setBriefOverlay] = useState(book.settings.briefOverlay ?? '');
  const [save, setSave] = useState<SaveState>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const committed = useRef(book.settings.briefOverlay ?? '');
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveBrief = (value: string) => {
    clearTimeout(fade.current);
    setSave('saving');
    void orderBookRequest(bookPath(book.id), project, { method: 'PATCH', body: { settings: { briefOverlay: value } } }).then(
      (updated) => {
        onBookChange?.(updated);
        setSave('saved');
        fade.current = setTimeout(() => setSave('idle'), SAVED_FADE_MS);
      },
      (cause: unknown) => {
        setSave('error');
        onError?.(errorMessage(cause));
      },
    );
  };

  const changeBrief = (value: string) => {
    setBriefOverlay(value);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const trimmed = value.trim();
      if (trimmed !== '' && !BRIEF_MD_PATTERN.test(trimmed)) return;
      if (trimmed === committed.current) return;
      committed.current = trimmed;
      saveBrief(trimmed);
    }, BRIEF_DEBOUNCE_MS);
  };

  const loadPreview = async () => {
    setLoadingPreview(true);
    try {
      const payload = await orderBookRequest<{ brief: string }>(bookPath(book.id, '/preview-brief'), project);
      setPreview(payload.brief);
    } catch (cause) {
      onError?.(errorMessage(cause));
    } finally {
      setLoadingPreview(false);
    }
  };

  const status = briefStatus(briefOverlay);
  return (
    <details className="rounded-lg border border-border bg-card text-xs" data-section="OrderBookMoreSettings">
      <summary className="cursor-pointer px-4 py-3 text-muted-foreground hover:text-foreground">More settings</summary>
      <div className="grid gap-4 border-t border-border px-4 py-4">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-3">
            <label htmlFor={`brief-${book.id}`} className="text-foreground">Extra instructions file</label>
            {save === 'saving' && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" role="status">
                <Loader2 size={10} className="animate-spin" /> Saving…
              </span>
            )}
            {save === 'saved' && <span className="text-[11px] text-success" role="status">Saved</span>}
            {save === 'error' && (
              <span className="text-[11px] text-destructive" role="alert">
                Could not save.{' '}
                <button type="button" className="underline" onClick={() => saveBrief(committed.current)}>Retry</button>
              </span>
            )}
          </div>
          <input
            id={`brief-${book.id}`}
            value={briefOverlay}
            onChange={(event) => changeBrief(event.target.value)}
            placeholder="docs/briefs/refactor-p3.md"
            className="max-w-md rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[11px] text-foreground"
          />
          <p className={`text-[11px] ${status.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{status.text}</p>
        </div>
        <div className="grid gap-2">
          <div>
            <button
              type="button"
              disabled={loadingPreview}
              onClick={() => void loadPreview()}
              className="rounded-md border border-border px-2.5 py-1.5 text-foreground hover:bg-accent disabled:opacity-50"
            >
              Preview what the Flywheel receives
            </button>
          </div>
          {preview !== null && (
            <pre aria-label="Brief preview" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-[11px] text-muted-foreground">{preview}</pre>
          )}
        </div>
      </div>
    </details>
  );
}
