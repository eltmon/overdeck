// "Open folder in <Editor>" items for the conversation header's ⋯ menu
// (PAN-5291 D1-5). MenuSurface has no submenus, so each editor is its own
// item. The launch code is PanOpenInPicker's, shared rather than copied.

import type { EditorId } from '@overdeck/contracts';
import { toast } from 'sonner';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { editorIconFor } from '../../EditorIcons';
import {
  EDITOR_LABELS,
  openFolderInEditor,
  openLinkedFolderInEditor,
  REMOTE_EDITOR_UNSUPPORTED_HINT,
  REMOTE_EDITORS,
  REMOTE_UNVERIFIED,
  useAvailableEditors,
} from '../../PanOpenInPicker';
import { MenuItemButton } from '../../shared/ContextMenu';
import { currentPlatform, formatSpec } from '../../../lib/shortcuts/keys';

export interface OpenFolderMenuItemsProps {
  conversation: Conversation;
  /** Closes the menu after a launch. */
  onDone: () => void;
}

export function OpenFolderMenuItems({ conversation, onDone }: OpenFolderMenuItemsProps) {
  return conversation.origin === 'linked'
    ? <LinkedOpenFolderItems conversation={conversation.name} onDone={onDone} />
    : <LocalOpenFolderItems cwd={conversation.cwd ?? null} onDone={onDone} />;
}

/** The favorite-editor shortcut (lib/keybindings `mod+shift+o`) in keycap text. */
function favoriteShortcutText(): string {
  const platform = currentPlatform();
  return formatSpec(platform === 'mac' ? 'Meta+Shift+O' : 'Ctrl+Shift+O', platform);
}

function LocalOpenFolderItems({ cwd, onDone }: { cwd: string | null; onDone: () => void }) {
  const { editors, defaultCwd, preferred } = useAvailableEditors();
  if (editors.length === 0) return null;
  const effectiveCwd = cwd ?? defaultCwd;
  const first = preferred && editors.includes(preferred) ? preferred : editors[0]!;
  const ordered: EditorId[] = [first, ...editors.filter((id) => id !== first)];
  return (
    <>
      {ordered.map((editorId) => {
        const Icon = editorIconFor(editorId);
        return (
          <MenuItemButton
            key={editorId}
            disabled={!effectiveCwd}
            title={effectiveCwd ? `Open ${effectiveCwd} in ${EDITOR_LABELS[editorId]}` : '(no cwd available)'}
            onClick={() => {
              if (effectiveCwd) void openFolderInEditor(effectiveCwd, editorId);
              onDone();
            }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{`Open folder in ${EDITOR_LABELS[editorId]}`}</span>
            {editorId === first && <span className="ml-auto text-muted-foreground">{favoriteShortcutText()}</span>}
          </MenuItemButton>
        );
      })}
    </>
  );
}

function LinkedOpenFolderItems({ conversation, onDone }: { conversation: string; onDone: () => void }) {
  return (
    <>
      {[...REMOTE_EDITORS, ...REMOTE_UNVERIFIED].map((editorId) => {
        const Icon = editorIconFor(editorId);
        const unsupported = REMOTE_UNVERIFIED.includes(editorId);
        return (
          <MenuItemButton
            key={editorId}
            disabled={unsupported}
            title={unsupported ? REMOTE_EDITOR_UNSUPPORTED_HINT : `Open over remote SSH in ${EDITOR_LABELS[editorId]}`}
            onClick={() => {
              void openLinkedFolderInEditor(conversation, editorId).then((commandLine) => {
                if (commandLine) toast.success(`Opening in ${EDITOR_LABELS[editorId]}`, { description: commandLine });
              });
              onDone();
            }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {`Open folder in ${EDITOR_LABELS[editorId]} (remote SSH)`}
          </MenuItemButton>
        );
      })}
    </>
  );
}
