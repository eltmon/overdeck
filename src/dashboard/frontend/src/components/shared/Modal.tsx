/**
 * Shared dialog primitive (PAN-4755 FR-2). Portals to document.body so a
 * caller inside an overflow: hidden or transformed container still covers
 * the viewport (D3). Owns focus management (D7/D8), Escape (D5) and scrim
 * dismissal (D6) so every dialog built on it gets the same accessible
 * behavior without re-implementing it.
 */
import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type ReactPortal } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

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
  /** Widens the panel for tabular content (760px instead of 600px). */
  wide?: boolean;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.closest('[hidden]'),
  );
}

export function Modal({ title, description, onClose, dismissible = true, onSubmit, pinned, footer, wide = false, children }: ModalProps): ReactPortal {
  const titleId = useId();
  const descriptionId = useId();
  // Cast keeps the element polymorphic (form when a submit handler is given,
  // otherwise a plain div) while still typing form-only props like onSubmit.
  const Panel = onSubmit ? 'form' : ('div' as unknown as 'form');
  const panelRef = useRef<HTMLFormElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrimPressedRef = useRef(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = bodyRef.current;
    const target = (body && focusableElements(body)[0]) ?? panelRef.current;
    target?.focus();
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
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
    if (!dismissible) return;
    if (pressedOnScrim && event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div className={styles.scrim} data-component="modal-scrim" onMouseDown={onScrimMouseDown} onClick={onScrimClick}>
      <Panel
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={wide ? `${styles.panel} ${styles.wide}` : styles.panel}
        data-component="modal"
        onKeyDown={onKeyDown}
        onSubmit={onSubmit}
      >
        <div className={styles.header}>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            {description && <p id={descriptionId} className={styles.description}>{description}</p>}
          </div>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose} disabled={!dismissible}>
            <X size={16} />
          </button>
        </div>
        <div ref={bodyRef} className={styles.body}>{children}</div>
        {pinned && <div className={styles.pinned}>{pinned}</div>}
        {footer && <div className={styles.footer}>{footer}</div>}
      </Panel>
    </div>,
    document.body,
  );
}
