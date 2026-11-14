/**
 * PAN-5237: the mounted composer registers itself as the place a cancelled
 * message's text goes back to. Text goes in through `editor.update` — the
 * editor writes its own draft on unmount, so writing the draft directly would
 * be overwritten. "Empty" means blank text, no pending attachments and no
 * pending citations (D5).
 */
import { useEffect, type RefObject } from 'react';
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from 'lexical';
import { getConversationAttachments, registerComposerRestoreTarget } from '../../lib/composerStore';
import { getConversationCitations } from '../../lib/composerCitations';

export function useComposerRestoreTarget(editorRef: RefObject<LexicalEditor | null>, conversationName: string): void {
  useEffect(() => registerComposerRestoreTarget(conversationName, {
    isEmpty: () => {
      const editor = editorRef.current;
      if (!editor) return false;
      let blank = false;
      editor.read(() => { blank = $getRoot().getTextContent().trim() === ''; });
      return blank
        && getConversationAttachments(conversationName).length === 0
        && getConversationCitations(conversationName).length === 0;
    },
    setText: (text) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        for (const line of text.split('\n')) {
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode(line));
          root.append(paragraph);
        }
      });
      editor.focus();
    },
  }), [conversationName, editorRef]);
}
