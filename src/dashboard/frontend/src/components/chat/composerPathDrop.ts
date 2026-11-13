/**
 * Insert explorer paths into a conversation composer (PAN-5190, FR-E9, D-E17).
 *
 * A tree row drag carries root-relative paths. Dropped on the composer, they
 * go in at the caret, one per line. With no range selection (the editor was
 * never focused), the caret moves to the end first, so the paths are appended.
 */
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';

export function insertPathsIntoComposer(editor: LexicalEditor, paths: readonly string[]): void {
  if (paths.length === 0) return;
  editor.update(() => {
    let selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      $getRoot().selectEnd();
      selection = $getSelection();
    }
    if ($isRangeSelection(selection)) selection.insertRawText(paths.join('\n'));
  });
  editor.focus();
}
