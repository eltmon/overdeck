/**
 * Add packs dialog (PAN-5540): the dashboard's trust step for known skill
 * packs, built on the same `addPack` core the CLI uses.
 *
 * On open it previews every pack in order, one request at a time (each
 * request fetches a git repo). Each preview shows what `pan skills pack add`
 * prints before "Trust this commit?". **Trust and add** then adds the
 * previewed packs one at a time with their previewed commits. A pack already
 * added is skipped; a pack whose ref moved since the preview is previewed
 * again and waits for another trust; a failure marks only that pack.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';
import { addPack, PACK_ADD_INVALIDATES, previewPack, type PackPreviewDto } from './availablePacks';

type RowState =
  | { kind: 'previewing' }
  | { kind: 'ready'; preview: PackPreviewDto }
  | { kind: 'adding'; preview: PackPreviewDto }
  | { kind: 'added'; preview: PackPreviewDto }
  | { kind: 'skipped' }
  | { kind: 'failed'; message: string; retry: 'preview' | 'add'; preview?: PackPreviewDto };

interface Row {
  state: RowState;
  /** Shown above the row until the next trust: why this pack was previewed again. */
  note?: string;
}

export interface AddPacksDialogProps {
  title: string;
  packIds: readonly string[];
  onClose: () => void;
  onAdded?: (ids: string[]) => void;
}

const CHANGED_NOTE = 'The pack changed since the preview.';
const short = (commit: string) => commit.slice(0, 7);
const plural = (n: number) => `${n} pack${n === 1 ? '' : 's'}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AddPacksDialog({ title, packIds, onClose, onAdded }: AddPacksDialogProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(packIds.map(id => [id, { state: { kind: 'previewing' } } satisfies Row])),
  );
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const started = useRef(false);

  const setRow = (id: string, state: RowState, note?: string | null) =>
    setRows(prev => ({ ...prev, [id]: { state, note: note === null ? undefined : (note ?? prev[id]?.note) } }));

  const runPreview = async (id: string) => {
    setRow(id, { kind: 'previewing' });
    try {
      const result = await previewPack(id);
      if (result.ok && result.body) setRow(id, { kind: 'ready', preview: result.body.preview });
      else if (result.code === 'exists') setRow(id, { kind: 'skipped' }, null);
      else setRow(id, { kind: 'failed', message: result.error ?? `HTTP ${result.status}`, retry: 'preview' });
    } catch (error) {
      setRow(id, { kind: 'failed', message: messageOf(error), retry: 'preview' });
    }
  };

  /** One add; true when the pack was registered. */
  const runAdd = async (id: string, preview: PackPreviewDto): Promise<boolean> => {
    setRow(id, { kind: 'adding', preview }, null);
    try {
      const result = await addPack(id, preview.commit);
      if (result.ok) {
        setRow(id, { kind: 'added', preview: result.body?.preview ?? preview });
        return true;
      }
      if (result.code === 'exists') {
        setRow(id, { kind: 'skipped' });
      } else if (result.code === 'commit-changed') {
        setRow(id, { kind: 'previewing' }, CHANGED_NOTE);
        await runPreview(id);
      } else {
        setRow(id, { kind: 'failed', message: result.error ?? `HTTP ${result.status}`, retry: 'add', preview });
      }
    } catch (error) {
      setRow(id, { kind: 'failed', message: messageOf(error), retry: 'add', preview });
    }
    return false;
  };

  const finishAdds = async (added: string[]) => {
    await Promise.all(PACK_ADD_INVALIDATES.map(queryKey => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
    setAddedCount(count => (count ?? 0) + added.length);
    if (added.length > 0) onAdded?.(added);
  };

  useEffect(() => {
    // StrictMode mounts effects twice in dev; previews start once.
    if (started.current) return;
    started.current = true;
    void (async () => {
      for (const id of packIds) await runPreview(id);
    })();
  }, []);

  const ready = packIds.flatMap(id => {
    const state = rows[id]?.state;
    return state?.kind === 'ready' ? [{ id, preview: state.preview }] : [];
  });
  const busy = adding || packIds.some(id => rows[id]?.state.kind === 'previewing' || rows[id]?.state.kind === 'adding');

  const trust = async () => {
    setAdding(true);
    const added: string[] = [];
    try {
      for (const { id, preview } of ready) {
        if (await runAdd(id, preview)) added.push(id);
      }
    } finally {
      setAdding(false);
    }
    await finishAdds(added);
  };

  const retry = async (id: string, state: Extract<RowState, { kind: 'failed' }>) => {
    if (state.retry === 'add' && state.preview) {
      setAdding(true);
      let added = false;
      try {
        added = await runAdd(id, state.preview);
      } finally {
        setAdding(false);
      }
      await finishAdds(added ? [id] : []);
      return;
    }
    await runPreview(id);
  };

  return (
    <Modal
      title={title}
      size="wide"
      onClose={onClose}
      dismissible={!adding}
      pinned={addedCount ? <p className="pt-2 text-sm text-foreground" role="status">Added {plural(addedCount)}.</p> : undefined}
      footer={
        <>
          <p className="mr-auto max-w-[44ch] text-xs leading-5 text-muted-foreground">
            Adding trusts these commits and turns nothing on. Turn packs on in Skill packs.
          </p>
          <button type="button" className={formStyles.button} onClick={onClose} disabled={adding}>
            {addedCount !== null && ready.length === 0 ? 'Done' : 'Cancel'}
          </button>
          {(addedCount === null || ready.length > 0) && (
            <button
              type="button"
              className={formStyles.primaryButton}
              disabled={busy || ready.length === 0}
              onClick={() => void trust()}
            >
              Trust and add {plural(ready.length)}
            </button>
          )}
        </>
      }
    >
      <div className="divide-y divide-border py-2">
        {packIds.map(id => {
          const row = rows[id];
          if (!row) return null;
          return (
            <PackPreviewRow key={id} id={id} row={row} disabled={busy} onRetry={state => void retry(id, state)} />
          );
        })}
      </div>
    </Modal>
  );
}

function statusText(state: RowState): string {
  switch (state.kind) {
    case 'previewing':
      return 'Fetching…';
    case 'ready':
      return 'ready to add';
    case 'adding':
      return 'Adding…';
    case 'added':
      return 'added';
    case 'skipped':
      return 'already added';
    case 'failed':
      return state.retry === 'add' ? 'add failed' : 'preview failed';
  }
}

interface PackPreviewRowProps {
  id: string;
  row: Row;
  disabled: boolean;
  onRetry: (state: Extract<RowState, { kind: 'failed' }>) => void;
}

function PackPreviewRow({ id, row, disabled, onRetry }: PackPreviewRowProps) {
  const { state } = row;
  const preview = 'preview' in state ? state.preview : undefined;
  return (
    <div data-add-pack={id} className="space-y-1 py-3 text-xs leading-5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono-ui text-[13px] text-foreground">{id}</span>
        <span className="text-muted-foreground">{statusText(state)}</span>
      </div>
      {row.note && <p className="text-body-foreground">{row.note}</p>}
      {state.kind === 'failed' && (
        <p className="text-body-foreground">
          {state.message}{' '}
          <button type="button" className="underline underline-offset-2" disabled={disabled} onClick={() => onRetry(state)}>
            Retry
          </button>
        </p>
      )}
      {preview && <PreviewDetails preview={preview} />}
    </div>
  );
}

/** D-14: the rows `pan skills pack add` prints for a pack without a runtime or a build. */
function PreviewDetails({ preview }: { preview: PackPreviewDto }) {
  const optIn = preview.skills.filter(skill => skill.optIn).map(skill => skill.name);
  const executables = preview.executables.length > 3 ? [...preview.executables.slice(0, 3), '…'] : preview.executables;
  const details: Array<[string, string]> = [
    ['Source', `${preview.url} @ ${preview.ref} (${short(preview.commit)})`],
    ...(preview.pluginRoot ? [['Root', preview.pluginRoot] as [string, string]] : []),
    ['Adapter', preview.adapter],
    ['License', preview.license ?? 'unknown'],
    ['Skills', `${preview.skills.length}${optIn.length ? ` · ${optIn.length} opt-in: ${optIn.join(', ')}` : ''}`],
    ...(preview.excluded.length
      ? [['Not mounted', preview.excluded.map(entry => `${entry.name} (${entry.reason})`).join(', ')] as [string, string]]
      : []),
    ...(executables.length ? [['Executables', executables.join(', ')] as [string, string]] : []),
    ...(preview.mcpServers.length
      ? [['MCP servers', preview.mcpServers.map(server => `${server.name} (${server.url})`).join(', ')] as [string, string]]
      : []),
    ['Not applied', preview.notApplied.length ? preview.notApplied.join(', ') : 'none'],
  ];
  return (
    <>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 text-muted-foreground">
        {details.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="min-w-0 break-words font-mono text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {preview.disclosure && <p className="max-w-[96ch] text-body-foreground">{preview.disclosure}</p>}
    </>
  );
}
