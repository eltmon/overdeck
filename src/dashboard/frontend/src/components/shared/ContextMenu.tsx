import * as Primitive from '@radix-ui/react-context-menu';
import { ChevronRight, Check } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type HTMLAttributes,
  type MutableRefObject,
  type RefObject,
} from 'react';

const MENU_SURFACE_CLASS =
  'max-h-[70vh] min-w-[168px] max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-floating';
const MENU_ITEM_CLASS =
  'relative flex w-full cursor-pointer select-none items-center gap-2 rounded px-3 py-1.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 data-[disabled]:pointer-events-none data-[disabled]:opacity-40';
const MENU_DESTRUCTIVE_ITEM_CLASS =
  'text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive';

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as MutableRefObject<T | null>).current = value;
}

function focusableMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'))
    .filter((item) => !item.hasAttribute('disabled') && item.closest('[role="menu"]') === menu);
}

function useReturnFocus(
  surfaceRef: RefObject<HTMLElement | null>,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const surface = surfaceRef.current;
    return () => {
      // Restore focus only when closing this surface actually stranded it:
      // either the focused node lived inside the now-unmounted surface (the
      // browser resets activeElement to body), or focus never moved at all.
      // When a menu action mounts a successor dialog with autofocus, the
      // commit-phase focus has already landed there — leave it alone.
      const active = document.activeElement;
      const focusLost = !active || active === document.body || active === document.documentElement;
      const focusOnSurface =
        !!surface && active instanceof HTMLElement && (surface === active || surface.contains(active));
      if (!focusLost && !focusOnSurface) return;
      const trigger = returnFocusRef?.current ?? previousFocusRef.current;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [surfaceRef, returnFocusRef]);
}

function useViewportConstraint(surfaceRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const constrain = () => {
      surface.style.translate = '';
      const rect = surface.getBoundingClientRect();
      const gutter = 8;
      const maxRight = window.innerWidth - gutter;
      const maxBottom = window.innerHeight - gutter;
      let x = 0;
      let y = 0;

      if (rect.right > maxRight) x -= rect.right - maxRight;
      if (rect.left + x < gutter) x += gutter - (rect.left + x);
      if (rect.bottom > maxBottom) y -= rect.bottom - maxBottom;
      if (rect.top + y < gutter) y += gutter - (rect.top + y);

      surface.style.translate = x || y ? `${x}px ${y}px` : '';
    };

    constrain();
    window.addEventListener('resize', constrain);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(constrain);
    observer?.observe(surface);
    return () => {
      window.removeEventListener('resize', constrain);
      observer?.disconnect();
    };
  }, [surfaceRef]);
}

export interface MenuSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  onClose?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  autoFocus?: boolean;
}

/**
 * Canonical frame and keyboard behavior for controlled/anchored action menus.
 * Radix context menus below use the same visual constants.
 */
export const MenuSurface = forwardRef<HTMLDivElement, MenuSurfaceProps>(function MenuSurface(
  { children, className = '', onClose, returnFocusRef, autoFocus = true, onKeyDown, ...props },
  forwardedRef,
) {
  const localRef = useRef<HTMLDivElement | null>(null);
  useReturnFocus(localRef, returnFocusRef);
  useViewportConstraint(localRef);

  useEffect(() => {
    if (!autoFocus) return;
    focusableMenuItems(localRef.current!)[0]?.focus();
  }, [autoFocus]);

  return (
    <div
      {...props}
      ref={(node) => {
        localRef.current = node;
        assignRef(forwardedRef, node);
      }}
      role="menu"
      className={classes(MENU_SURFACE_CLASS, className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const items = focusableMenuItems(event.currentTarget);
        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        let target: HTMLElement | undefined;
        if (event.key === 'ArrowDown') target = items[(currentIndex + 1 + items.length) % items.length];
        if (event.key === 'ArrowUp') target = items[(currentIndex - 1 + items.length) % items.length];
        if (event.key === 'Home') target = items[0];
        if (event.key === 'End') target = items.at(-1);
        if (target) {
          event.preventDefault();
          target.focus();
        }
        if (event.key === 'Escape' && onClose) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
});

export interface MenuItemButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  destructive?: boolean;
  active?: boolean;
}

export const MenuItemButton = forwardRef<HTMLButtonElement, MenuItemButtonProps>(function MenuItemButton(
  { children, className = '', destructive = false, active = false, type = 'button', ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      role="menuitem"
      className={classes(MENU_ITEM_CLASS, destructive && MENU_DESTRUCTIVE_ITEM_CLASS, active && 'text-primary', className)}
    >
      {children}
    </button>
  );
});

export function MenuSeparator({ className = '' }: { className?: string }) {
  return <div role="separator" className={classes('mx-1 my-1 h-px bg-border', className)} />;
}

export function MenuOverlay({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes('fixed inset-0 z-[999]', className)} />;
}

export interface PopoverSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  onClose?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  autoFocus?: boolean;
}

/** Canonical frame for non-menu floating controls such as confirmation popovers. */
export const PopoverSurface = forwardRef<HTMLDivElement, PopoverSurfaceProps>(function PopoverSurface(
  { children, className = '', onClose, returnFocusRef, autoFocus = true, onKeyDown, role = 'dialog', ...props },
  forwardedRef,
) {
  const localRef = useRef<HTMLDivElement | null>(null);
  useReturnFocus(localRef, returnFocusRef);
  useViewportConstraint(localRef);

  useEffect(() => {
    if (!autoFocus) return;
    localRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), [tabindex="0"]')?.focus();
  }, [autoFocus]);

  return (
    <div
      {...props}
      ref={(node) => {
        localRef.current = node;
        assignRef(forwardedRef, node);
      }}
      role={role}
      className={classes(MENU_SURFACE_CLASS, className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === 'Escape' && onClose) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
});

export const ContextMenuRoot = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export const ContextMenuPortal = Primitive.Portal;

export function ContextMenuContent({
  children,
  className = '',
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        {...props}
        className={classes('z-[1000]', MENU_SURFACE_CLASS, className)}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function ContextMenuItem({
  children,
  className = '',
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      {...props}
      className={classes(MENU_ITEM_CLASS, 'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground', className)}
    >
      {children}
    </Primitive.Item>
  );
}

export function ContextMenuDestructiveItem({
  children,
  className = '',
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      {...props}
      className={classes(MENU_ITEM_CLASS, MENU_DESTRUCTIVE_ITEM_CLASS, 'data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive', className)}
    >
      {children}
    </Primitive.Item>
  );
}

export function ContextMenuSeparator() {
  return <Primitive.Separator className="my-1 h-px bg-border mx-1" />;
}

export function ContextMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <Primitive.Label className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </Primitive.Label>
  );
}

export function ContextMenuSub({ children }: { children: React.ReactNode }) {
  return <Primitive.Sub>{children}</Primitive.Sub>;
}

export function ContextMenuSubTrigger({
  children,
  disabled,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Primitive.SubTrigger
      disabled={disabled}
      className={classes(MENU_ITEM_CLASS, 'justify-between data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent')}
    >
      <span className="flex-1">{children}</span>
      <ChevronRight size={11} className="ml-2 shrink-0 opacity-50" />
    </Primitive.SubTrigger>
  );
}

export function ContextMenuSubContent({ children }: { children: React.ReactNode }) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        sideOffset={2}
        alignOffset={-4}
        className={classes('z-[1001] min-w-[180px] max-h-[320px]', MENU_SURFACE_CLASS)}
      >
        {children}
      </Primitive.SubContent>
    </Primitive.Portal>
  );
}

export function ContextMenuCheckItem({
  children,
  checked,
  onSelect,
}: {
  children: React.ReactNode;
  checked?: boolean;
  onSelect?: () => void;
}) {
  return (
    <Primitive.CheckboxItem
      checked={checked}
      onSelect={onSelect}
      className={classes(MENU_ITEM_CLASS, 'pl-7 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground')}
    >
      <Primitive.ItemIndicator className="absolute left-2 flex items-center justify-center">
        <Check size={11} />
      </Primitive.ItemIndicator>
      {children}
    </Primitive.CheckboxItem>
  );
}
