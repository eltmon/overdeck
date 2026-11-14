/**
 * PAN-5237 — a cancelled message's text goes back into the mounted, empty
 * composer; otherwise it stays in the outbox as Cancelled.
 */
import { renderHook } from '@testing-library/react';
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetComposerStore, useComposerStore } from '../../../lib/composerStore';
import { useComposerRestoreTarget } from '../useComposerRestoreTarget';

const CONV = 'restore-conv';

function editorText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent());
}

function setEditorText(editor: LexicalEditor, text: string): void {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode(text));
    root.append(paragraph);
  }, { discrete: true });
}

async function cancelQueued(text: string, clientMessageId = 'c1'): Promise<void> {
  const store = useComposerStore.getState();
  store.addOptimistic(CONV, text, 0, { clientMessageId, sendPhase: 'queued' });
  const id = useComposerStore.getState().byConversation[CONV]!.optimistic.find((m) => m.clientMessageId === clientMessageId)!.id;
  await useComposerStore.getState().cancelSend(id);
}

describe('useComposerRestoreTarget', () => {
  let editor: LexicalEditor;
  let ref: { current: LexicalEditor | null };

  beforeEach(() => {
    resetComposerStore();
    editor = createEditor({ namespace: 'test', onError: (error) => { throw error; } });
    ref = { current: editor };
  });

  afterEach(() => { resetComposerStore(); });

  const failed = () => useComposerStore.getState().byConversation[CONV]?.failed ?? [];

  it('puts the cancelled text into an empty editor and adds no outbox entry', async () => {
    renderHook(() => useComposerRestoreTarget(ref, CONV));
    await cancelQueued('first line\nsecond line');
    await vi.waitFor(() => expect(editorText(editor)).toBe('first line\n\nsecond line'));
    expect(editor.getEditorState().read(() => $getRoot().getChildrenSize())).toBe(2);
    expect(failed()).toEqual([]);
  });

  it('keeps typed text and sends the cancelled message to the outbox', async () => {
    setEditorText(editor, 'draft');
    renderHook(() => useComposerRestoreTarget(ref, CONV));
    await cancelQueued('cancelled message');
    expect(editorText(editor)).toBe('draft');
    expect(failed()).toEqual([expect.objectContaining({ code: 'cancelled', text: 'cancelled message' })]);
  });

  it('after unmount the cancelled message goes to the outbox', async () => {
    const { unmount } = renderHook(() => useComposerRestoreTarget(ref, CONV));
    unmount();
    await cancelQueued('after unmount');
    expect(editorText(editor)).toBe('');
    expect(failed()).toEqual([expect.objectContaining({ code: 'cancelled', text: 'after unmount' })]);
  });

  it('a pending attachment makes the composer count as not empty', async () => {
    renderHook(() => useComposerRestoreTarget(ref, CONV));
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    try {
      useComposerStore.getState().enqueueAttachments(CONV, [new File(['x'], 'notes.txt', { type: 'text/plain' })]);
      expect(useComposerStore.getState().byConversation[CONV]?.attachments).toHaveLength(1);
      await cancelQueued('with attachment');
      expect(editorText(editor)).toBe('');
      expect(failed()).toEqual([expect.objectContaining({ code: 'cancelled' })]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
