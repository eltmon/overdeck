/**
 * The composer's shared trigger menu (PAN-5662): one presentational listbox
 * and one keyboard handler serve the `/` commands, `@` files and `$` skills
 * menus. Callers pass rows that are already filtered and ordered; the menu
 * groups them by category, highlights the filter, closes on a click outside,
 * and keeps the selected row in view.
 */
import { useEffect, useRef } from 'react';
import styles from '../CommandDeck/styles/command-deck.module.css';
import type { SlashCommand } from './slashCommandTypes';

export function renderHighlightedText(text: string, filter: string, className: string) {
  if (!filter) return text;

  const normalizedText = text.toLowerCase();
  const normalizedFilter = filter.toLowerCase();
  const matchIndex = normalizedText.indexOf(normalizedFilter);

  if (matchIndex < 0) return text;

  const matchEnd = matchIndex + filter.length;
  return (
    <>
      {text.slice(0, matchIndex)}
      <mark className={className}>{text.slice(matchIndex, matchEnd)}</mark>
      {text.slice(matchEnd)}
    </>
  );
}

export interface TriggerMenuProps {
  /** Rows, already filtered and in display order (category-contiguous). */
  items: SlashCommand[];
  /** The typed filter, used only for highlighting. */
  filter: string;
  selectedIndex: number;
  onSelect: (item: SlashCommand) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
  ariaLabel: string;
  /** Shown as one non-selectable row when `items` is empty; without it an empty menu renders nothing. */
  hint?: string;
}

export function TriggerMenu({ items, filter, selectedIndex, onSelect, onClose, anchorRect, ariaLabel, hint }: TriggerMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.slashMenu}`)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Scroll the selected item into view
  useEffect(() => {
    if (menuRef.current) {
      const selected = menuRef.current.querySelector('[aria-selected="true"]');
      if (selected && typeof (selected as HTMLElement).scrollIntoView === 'function') {
        (selected as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (items.length === 0 && !hint) return null;

  // Always position above the anchor (composer is at the bottom of the screen)
  const left = anchorRect ? anchorRect.left : 0;
  const bottom = anchorRect ? window.innerHeight - anchorRect.top + 4 : 0;

  // Group rows by category
  const groupedItems = items.reduce((acc, item) => {
    const category = item.category || 'Commands';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, SlashCommand[]>);

  const categories = Object.keys(groupedItems);

  return (
    <div
      ref={menuRef}
      className={styles.slashMenu}
      style={{ bottom, left }}
      role="listbox"
      aria-label={ariaLabel}
    >
      {items.length === 0 && <div className={styles.slashMenuHint}>{hint}</div>}
      {categories.map((category) => (
        <div key={category}>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 px-3 py-1.5">
            {category}
          </div>
          {groupedItems[category].map((item) => {
            const globalIndex = items.findIndex(c => c.id === item.id);
            const labelMatches = filter ? item.label.toLowerCase().includes(filter.toLowerCase()) : false;
            return (
              <button
                key={item.id}
                className={`${styles.slashMenuItem} ${globalIndex === selectedIndex ? styles.slashMenuItemSelected : ''}`}
                // Keep focus and the caret in the editor: the @ and $ menus splice at the live selection.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(item)}
                role="option"
                aria-selected={globalIndex === selectedIndex}
              >
                <span className={styles.slashMenuLabel}>
                  {labelMatches
                    ? renderHighlightedText(item.label, filter, styles.slashMenuMatch)
                    : item.label}
                </span>
                <span className={styles.slashMenuDescription}>
                  {labelMatches
                    ? item.description
                    : renderHighlightedText(item.description, filter, styles.slashMenuMatch)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export interface TriggerMenuKeysOptions {
  open: boolean;
  rowCount: number;
  selectedIndex: number;
  setSelectedIndex: (update: (index: number) => number) => void;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
  /** Tab inserts the selected row (`@`, `$`); otherwise Tab only closes the menu (`/`). */
  tabSelects: boolean;
}

/**
 * Arrow keys move, Enter selects when rows exist, Escape closes, Tab selects
 * or closes. Listens on the document in the capture phase so it runs before
 * Lexical's own keydown handling.
 */
export function useTriggerMenuKeys({
  open,
  rowCount,
  selectedIndex,
  setSelectedIndex,
  onSelectIndex,
  onClose,
  tabSelects,
}: TriggerMenuKeysOptions): void {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // An IME confirmation Enter belongs to the composition, never the menu.
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (rowCount > 0) setSelectedIndex((i) => (i + 1) % rowCount);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (rowCount > 0) setSelectedIndex((i) => (i - 1 + rowCount) % rowCount);
      } else if (e.key === 'Enter') {
        if (rowCount > 0 && selectedIndex < rowCount) {
          e.preventDefault();
          e.stopPropagation();
          onSelectIndex(selectedIndex);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        if (tabSelects && rowCount > 0 && selectedIndex < rowCount) {
          e.preventDefault();
          e.stopPropagation();
          onSelectIndex(selectedIndex);
        } else {
          onClose();
        }
      }
    };

    // Use capture phase so we intercept before Lexical's keydown handler
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, rowCount, selectedIndex, setSelectedIndex, onSelectIndex, onClose, tabSelects]);
}

/** The caret's rect, or the editor root's bounds when the caret has no measurable rect (empty editor). */
export function caretAnchorRect(root: HTMLElement): DOMRect {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0 || rect.bottom > 0) {
      return rect;
    }
  }
  return root.getBoundingClientRect();
}
