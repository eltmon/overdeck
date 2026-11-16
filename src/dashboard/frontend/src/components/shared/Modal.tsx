/**
 * Shared dialog primitive (PAN-4755 FR-2). Portals to document.body so a
 * caller inside an overflow: hidden or transformed container still covers
 * the viewport (D3). Owns focus management (D7/D8), Escape (D5) and scrim
 * dismissal (D6) so every dialog built on it gets the same accessible
 * behavior without re-implementing it.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

export type ModalSize = 'narrow' | 'default' | 'wide' | 'xl';

export interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  /** false disables Escape, scrim click and the close button (default true). */
  dismissible?: boolean;
  /** When set, the panel renders as a <form> so a submit button in `footer` submits it. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** Non-scrolling region above the footer, e.g. an error alert. */
  pinned?: ReactNode;
  footer?: ReactNode;
  /** Panel max width: narrow 440px, default 600px, wide 760px, xl 1000px (PAN-4756 D2). */
  size?: ModalSize;
  /** Renders role="alertdialog" (DialogProvider confirm/alert). */
  alert?: boolean;
  /** Accessible name when it must differ from the visible title (kept from a pre-Modal dialog). */
  ariaLabel?: string;
  /** Accessible name of the header close button (default "Close"). */
  closeLabel?: string;
  /** Extra header buttons, rendered before the close button. */
  headerActions?: ReactNode;
  /** Runs first for every key pressed inside the panel; call preventDefault() to skip Modal's own Escape/Tab handling. */
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  /** No header row: the caller renders its own heading and passes its id in labelledBy. */
  headless?: boolean;
  /** id of the caller's heading that names the dialog (used with `headless`). */
  labelledBy?: string;
  /** aria-describedby target when the description is the caller's own element (AskUserQuestion's first question). Overrides `description`'s id. */
  describedBy?: string;
  /** "warning" draws the needs-you border (PAN-4754 FR-14). */
  tone?: 'default' | 'warning';
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.closest('[hidden]'),
  );
}

const SIZE_CLASS: Record<ModalSize, string | undefined> = {
  narrow: styles.sizeNarrow,
  default: styles.sizeDefault,
  wide: styles.sizeWide,
  xl: styles.sizeXl,
};

export function Modal({
  title,
  description,
  onClose,
  dismissible = true,
  onSubmit,
  pinned,
  footer,
  size = 'default',
  alert = false,
  ariaLabel,
  closeLabel,
  headerActions,
  onKeyDown: onCallerKeyDown,
  headless = false,
  labelledBy,
  describedBy,
  tone = 'default',
  children,
}: ModalProps): ReactPortal {
  const titleId = useId();
  const descriptionId = useId();
  // Cast keeps the element polymorphic (form when a submit handler is given,
  // otherwise a plain div) while still typing form-only props like onSubmit.
  const Panel = onSubmit ? 'form' : ('div' as unknown as 'form');
  const panelRef = useRef<HTMLFormElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const scrimPressedRef = useRef(false);
  // Captured at first render, before a child's autoFocus or this component's
  // effect moves focus into the panel (PAN-4756 FR-1).
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const restore = () => {
      if (opener && document.contains(opener)) opener.focus();
    };
    // A child already placed focus (autoFocus): keep it.
    if (panelRef.current?.contains(document.activeElement)) return restore;
    const body = bodyRef.current;
    const target = (body && focusableElements(body)[0]) ?? panelRef.current;
    target?.focus();
    return restore;
  }, [opener]);

  // A dialog that swaps its body (a form replaced by its result) removes the
  // focused control, and focus falls to <body>, outside the panel: Escape and
  // the Tab trap then stop working. Pull focus back to the panel. Observe the
  // scrim, not the panel: dropping onSubmit turns the panel from a form into a
  // div, which React mounts as a new element.
  useEffect(() => {
    const scrim = scrimRef.current;
    if (!scrim) return;
    const observer = new MutationObserver(() => {
      if (document.activeElement === null || document.activeElement === document.body) panelRef.current?.focus();
    });
    observer.observe(scrim, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // React bubbles a nested portal's key events through the React tree; only
    // react to keys pressed inside this panel's DOM.
    if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) return;
    onCallerKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!dismissible) return;
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusableElements(panel);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || active === panel)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      }
    }
  };

  const onScrimMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    scrimPressedRef.current = event.target === event.currentTarget;
  };

  const onScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    const pressedOnScrim = scrimPressedRef.current;
    scrimPressedRef.current = false;
    // The modal portals to document.body, but React still bubbles its clicks
    // to the caller's ancestors (a kanban card, a tree row); stop them here.
    event.stopPropagation();
    if (!dismissible) return;
    if (pressedOnScrim && event.target === event.currentTarget) onClose();
  };

  const panelClassName = [styles.panel, SIZE_CLASS[size], tone === 'warning' && styles.warning].filter(Boolean).join(' ');
  const bodyClassName = headless ? `${styles.body} ${styles.headlessBody}` : styles.body;

  return createPortal(
    <div ref={scrimRef} className={styles.scrim} data-component="modal-scrim" onMouseDown={onScrimMouseDown} onClick={onScrimClick}>
      <Panel
        ref={panelRef}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : (labelledBy ?? titleId)}
        aria-describedby={describedBy ?? (description && !headless ? descriptionId : undefined)}
        tabIndex={-1}
        className={panelClassName}
        data-component="modal"
        onKeyDown={onKeyDown}
        onSubmit={onSubmit}
      >
        {!headless && (
          <div className={styles.header}>
            <div className={styles.titles}>
              <h2 id={titleId} className={styles.title}>{title}</h2>
              {description && <p id={descriptionId} className={styles.description}>{description}</p>}
            </div>
            {headerActions && <div className={styles.headerActions}>{headerActions}</div>}
            <button type="button" className={styles.close} aria-label={closeLabel ?? 'Close'} onClick={onClose} disabled={!dismissible}>
              <X size={16} />
            </button>
          </div>
        )}
        <div ref={bodyRef} className={bodyClassName}>{children}</div>
        {pinned && <div className={styles.pinned}>{pinned}</div>}
        {footer && <div className={styles.footer}>{footer}</div>}
      </Panel>
    </div>,
    document.body,
  );
}
