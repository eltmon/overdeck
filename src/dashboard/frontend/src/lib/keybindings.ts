import { useEffect } from 'react';
import { EDITORS, type EditorId, WS_METHODS } from '@panctl/contracts';
import { toast } from 'sonner';

import { getPreferredEditor, setPreferredEditor } from '../editorPreferences';
import { getTransport, type PanRpcProtocolClient } from './wsTransport';

export const EDITOR_OPEN_FAVORITE_KEY = 'mod+shift+o';
export const EDITOR_OPEN_FAVORITE_KEY_LABEL = '⌘⇧O';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function isEditorOpenFavoriteEvent(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === 'o'
    && event.shiftKey
    && (event.metaKey || event.ctrlKey)
    && !event.altKey;
}

async function resolvePreferredEditor(): Promise<EditorId> {
  const result = await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.getAvailableEditors](),
  );
  const availableEditors = (result as { editors: EditorId[] }).editors;
  const preferred = getPreferredEditor();
  const editor = preferred && availableEditors.includes(preferred)
    ? preferred
    : EDITORS.find((entry) => availableEditors.includes(entry.id))?.id;
  if (!editor) throw new Error('No available editors found.');
  setPreferredEditor(editor);
  return editor;
}

export async function openFavoriteEditor(cwd: string): Promise<EditorId> {
  const editor = await resolvePreferredEditor();
  await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.shellOpenInEditor]({ cwd, editor }),
  );
  return editor;
}

export function useEditorOpenFavoriteShortcut(cwd: string): void {
  useEffect(() => {
    if (!cwd) return;
    const root = document.getElementById('root') ?? document.body;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableTarget(event.target) || !isEditorOpenFavoriteEvent(event)) return;
      event.preventDefault();
      void openFavoriteEditor(cwd).catch((error) => {
        toast.error(`Failed to open editor: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [cwd]);
}
